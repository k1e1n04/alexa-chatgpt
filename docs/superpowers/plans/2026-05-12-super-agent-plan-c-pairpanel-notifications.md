# pairpanel 通知 API + UI 実装プラン（Plan C）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pairpanel（PRD）に Alexa 通知を受け取る API とフロントエンド通知ページを追加し、チャッピーがブリーフィング・タスク完了・アラートをペアパネルに書き込めるようにする。

**Architecture:** Alexa Lambda（STG）→ AlexaAPIKeyMiddleware で POST → `alexa_notifications` DynamoDB テーブルに保存。フロントエンドは JWTAuthMiddleware で GET/PUT → 通知ページで表示・既読管理。

**Tech Stack:** Go（Echo v4, dig DI, aws-sdk-go-v2）、TypeScript（Next.js 14 App Router, Server Components）、AWS CDK（DynamoDB）

**Working directories:**
- `ken-nao-cdk/` — CDK infra (DynamoDB)
- `ken-nao-api-legacy/` — Go API
- `ken-nao-frontend/` — Next.js

---

### Task 1: CDK — DynamoDB テーブル追加

**Files:**
- Modify: `ken-nao-cdk/bin/prd/prd-dynamodb-schema.ts`
- Modify: `ken-nao-cdk/bin/stg/stg-dynamodb-schema.ts`

- [ ] **Step 1: `prd-dynamodb-schema.ts` に `alexa_notifications` テーブルを追加**

`ken-nao-cdk/bin/prd/prd-dynamodb-schema.ts` の末尾（`];` の直前）に追記：

```typescript
  // Alexa チャッピー通知テーブル
  {
    tableName: "alexa_notifications",
    partitionKeyName: "notification_id",
    partitionKeyType: AttributeType.STRING,
    timeToLiveAttribute: "ttl",
    globalSecondaryIndexes: [
      {
        indexName: "user_id-created_at-idx",
        partitionKey: {
          name: "user_id",
          type: AttributeType.STRING,
        },
        sortKey: {
          name: "created_at",
          type: AttributeType.STRING,
        },
      },
    ],
  },
```

- [ ] **Step 2: `stg-dynamodb-schema.ts` にも同じエントリを追加**（ローカル開発・STG テスト用）

`ken-nao-cdk/bin/stg/stg-dynamodb-schema.ts` の末尾（`];` の直前）に同一ブロックを追記。

- [ ] **Step 3: CDK diff で差分確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-cdk
npx cdk diff KenNaoPrdDynamodbStack --profile prd 2>&1 | grep -E "alexa|Resource"
```

Expected: `alexa_notifications` テーブルと GSI が追加対象として表示される。

- [ ] **Step 4: CDK deploy（PRD）**

```bash
npx cdk deploy KenNaoPrdDynamodbStack --profile prd --require-approval never
```

Expected: `✅  KenNaoPrdDynamodbStack` と出力される。

- [ ] **Step 5: テーブル存在確認**

```bash
aws dynamodb describe-table \
  --table-name prd-alexa_notifications \
  --profile prd \
  --region ap-northeast-1 \
  --query "Table.TableName"
```

Expected: `"prd-alexa_notifications"` が返る。

- [ ] **Step 6: commit**

```bash
cd /Users/ishiiken/Develop/ken-nao
git add ken-nao-cdk/bin/prd/prd-dynamodb-schema.ts ken-nao-cdk/bin/stg/stg-dynamodb-schema.ts
git commit -m "feat(cdk): add alexa_notifications DynamoDB table"
```

---

### Task 2: Domain 層 — エンティティ + リポジトリインターフェース

**Files:**
- Create: `ken-nao-api-legacy/src/domain/alexa_notification/alexa_notification_entity.go`
- Create: `ken-nao-api-legacy/src/domain/alexa_notification/alexa_notification_repository.go`

- [ ] **Step 1: エンティティファイルを作成**

```go
// ken-nao-api-legacy/src/domain/alexa_notification/alexa_notification_entity.go
package alexa_notification

import "time"

// AlexaNotificationEntity Alexa 通知エンティティ
type AlexaNotificationEntity struct {
	NotificationID string
	UserID         string
	Kind           string     // "briefing" | "reminder" | "task-result" | "alert"
	Title          string
	Body           string
	Severity       string     // "low" | "mid" | "high" | "critical"
	CreatedAt      time.Time
	ReadAt         *time.Time
	TTL            int64
}
```

- [ ] **Step 2: リポジトリインターフェースを作成**

```go
// ken-nao-api-legacy/src/domain/alexa_notification/alexa_notification_repository.go
package alexa_notification

// AlexaNotificationRepository Alexa 通知のリポジトリインターフェース
type AlexaNotificationRepository interface {
	// Save は通知を保存する
	Save(notification *AlexaNotificationEntity) error
	// FindByUserID はユーザーIDに紐づく通知を作成日時降順で最大50件取得する
	FindByUserID(userID string) ([]*AlexaNotificationEntity, error)
	// MarkAsRead は通知を既読にする
	MarkAsRead(notificationID string) error
}
```

- [ ] **Step 3: ビルド確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go build ./src/domain/alexa_notification/...
```

Expected: エラーなし。

- [ ] **Step 4: commit**

```bash
git add src/domain/alexa_notification/
git commit -m "feat(domain): add AlexaNotification entity and repository interface"
```

---

### Task 3: Persistence 層 — DynamoDB レコード + リポジトリ実装

**Files:**
- Create: `ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_record.go`
- Create: `ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_repository_impl.go`
- Create: `ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_repository_impl_test.go`

- [ ] **Step 1: DynamoDB レコード struct を作成**

```go
// ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_record.go
package alexa_notification

import (
	"time"

	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
)

// AlexaNotificationRecord DynamoDB テーブルレコード
type AlexaNotificationRecord struct {
	NotificationID string  `dynamodbav:"notification_id"`
	UserID         string  `dynamodbav:"user_id"`
	Kind           string  `dynamodbav:"kind"`
	Title          string  `dynamodbav:"title"`
	Body           string  `dynamodbav:"body"`
	Severity       string  `dynamodbav:"severity"`
	CreatedAt      string  `dynamodbav:"created_at"` // RFC3339
	ReadAt         *string `dynamodbav:"read_at,omitempty"`
	TTL            int64   `dynamodbav:"ttl"`
}

// ToEntity レコードをエンティティに変換する
func (r *AlexaNotificationRecord) ToEntity() *entity.AlexaNotificationEntity {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	var readAt *time.Time
	if r.ReadAt != nil {
		t, _ := time.Parse(time.RFC3339, *r.ReadAt)
		readAt = &t
	}
	return &entity.AlexaNotificationEntity{
		NotificationID: r.NotificationID,
		UserID:         r.UserID,
		Kind:           r.Kind,
		Title:          r.Title,
		Body:           r.Body,
		Severity:       r.Severity,
		CreatedAt:      createdAt,
		ReadAt:         readAt,
		TTL:            r.TTL,
	}
}

// FromEntity エンティティからレコードを生成する
func (r *AlexaNotificationRecord) FromEntity(e *entity.AlexaNotificationEntity) *AlexaNotificationRecord {
	var readAt *string
	if e.ReadAt != nil {
		s := e.ReadAt.Format(time.RFC3339)
		readAt = &s
	}
	return &AlexaNotificationRecord{
		NotificationID: e.NotificationID,
		UserID:         e.UserID,
		Kind:           e.Kind,
		Title:          e.Title,
		Body:           e.Body,
		Severity:       e.Severity,
		CreatedAt:      e.CreatedAt.Format(time.RFC3339),
		ReadAt:         readAt,
		TTL:            e.TTL,
	}
}
```

- [ ] **Step 2: リポジトリ実装を作成**

```go
// ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_repository_impl.go
package alexa_notification

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
	"github.com/k1e1n04/ken-nao-api-legacy/src/infrastructure/dbutil"
)

const tableKey = "alexa_notifications"

// AlexaNotificationRepositoryImpl リポジトリ実装
type AlexaNotificationRepositoryImpl struct {
	db *dynamodb.Client
}

// NewAlexaNotificationRepository リポジトリのコンストラクタ
func NewAlexaNotificationRepository(db *dynamodb.Client) entity.AlexaNotificationRepository {
	return &AlexaNotificationRepositoryImpl{db: db}
}

// Save 通知を保存する
func (r *AlexaNotificationRepositoryImpl) Save(n *entity.AlexaNotificationEntity) error {
	record := (&AlexaNotificationRecord{}).FromEntity(n)
	item, err := attributevalue.MarshalMap(record)
	if err != nil {
		return err
	}
	_, err = r.db.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(dbutil.GetTableName(tableKey)),
		Item:      item,
	})
	return err
}

// FindByUserID ユーザーIDに紐づく通知を作成日時降順で最大50件取得する
func (r *AlexaNotificationRepositoryImpl) FindByUserID(userID string) ([]*entity.AlexaNotificationEntity, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(dbutil.GetTableName(tableKey)),
		IndexName:              aws.String("user_id-created_at-idx"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid": &types.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            aws.Int32(50),
	}
	result, err := r.db.Query(context.Background(), input)
	if err != nil {
		return nil, err
	}
	var records []AlexaNotificationRecord
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &records); err != nil {
		return nil, err
	}
	entities := make([]*entity.AlexaNotificationEntity, len(records))
	for i, rec := range records {
		rec := rec
		entities[i] = rec.ToEntity()
	}
	return entities, nil
}

// MarkAsRead 通知を既読にする
func (r *AlexaNotificationRepositoryImpl) MarkAsRead(notificationID string) error {
	now := time.Now().Format(time.RFC3339)
	_, err := r.db.UpdateItem(context.Background(), &dynamodb.UpdateItemInput{
		TableName: aws.String(dbutil.GetTableName(tableKey)),
		Key: map[string]types.AttributeValue{
			"notification_id": &types.AttributeValueMemberS{Value: notificationID},
		},
		UpdateExpression: aws.String("SET read_at = :read_at"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":read_at": &types.AttributeValueMemberS{Value: now},
		},
	})
	return err
}
```

- [ ] **Step 3: テストを作成（record の変換ロジック）**

```go
// ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification/alexa_notification_repository_impl_test.go
package alexa_notification

import (
	"testing"
	"time"

	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
)

func TestAlexaNotificationRecord_RoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second) // RFC3339 は秒単位
	readAt := now.Add(time.Minute)

	original := &entity.AlexaNotificationEntity{
		NotificationID: "test-id-123",
		UserID:         "user-456",
		Kind:           "briefing",
		Title:          "朝のブリーフィング",
		Body:           "今日は晴れです",
		Severity:       "low",
		CreatedAt:      now,
		ReadAt:         &readAt,
		TTL:            now.Add(7 * 24 * time.Hour).Unix(),
	}

	record := (&AlexaNotificationRecord{}).FromEntity(original)
	restored := record.ToEntity()

	if restored.NotificationID != original.NotificationID {
		t.Errorf("NotificationID: want %s, got %s", original.NotificationID, restored.NotificationID)
	}
	if restored.UserID != original.UserID {
		t.Errorf("UserID: want %s, got %s", original.UserID, restored.UserID)
	}
	if restored.Kind != original.Kind {
		t.Errorf("Kind: want %s, got %s", original.Kind, restored.Kind)
	}
	if !restored.CreatedAt.Equal(original.CreatedAt) {
		t.Errorf("CreatedAt: want %v, got %v", original.CreatedAt, restored.CreatedAt)
	}
	if restored.ReadAt == nil || !restored.ReadAt.Equal(*original.ReadAt) {
		t.Errorf("ReadAt mismatch")
	}
}

func TestAlexaNotificationRecord_RoundTrip_NilReadAt(t *testing.T) {
	now := time.Now().Truncate(time.Second)

	original := &entity.AlexaNotificationEntity{
		NotificationID: "test-id-789",
		UserID:         "user-789",
		Kind:           "alert",
		Title:          "アラート",
		Body:           "内容",
		Severity:       "high",
		CreatedAt:      now,
		ReadAt:         nil,
		TTL:            now.Add(7 * 24 * time.Hour).Unix(),
	}

	record := (&AlexaNotificationRecord{}).FromEntity(original)
	restored := record.ToEntity()

	if restored.ReadAt != nil {
		t.Errorf("ReadAt: want nil, got %v", restored.ReadAt)
	}
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go test ./src/infrastructure/persistence/alexa_notification/... -v
```

Expected: 2 テストが PASS。

- [ ] **Step 5: ビルド確認**

```bash
go build ./src/infrastructure/persistence/alexa_notification/...
```

Expected: エラーなし。

- [ ] **Step 6: commit**

```bash
git add src/infrastructure/persistence/alexa_notification/
git commit -m "feat(persistence): add AlexaNotification DynamoDB repository"
```

---

### Task 4: Application 層 — DTO + サービス

**Files:**
- Create: `ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_dto.go`
- Create: `ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_service.go`
- Create: `ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_service_test.go`

- [ ] **Step 1: DTO ファイルを作成**

```go
// ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_dto.go
package alexa_notification

import (
	"time"

	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
)

// AlexaNotificationDTO Alexa 通知 DTO
type AlexaNotificationDTO struct {
	NotificationID string     `json:"notificationId"`
	UserID         string     `json:"userId"`
	Kind           string     `json:"kind"`
	Title          string     `json:"title"`
	Body           string     `json:"body"`
	Severity       string     `json:"severity"`
	CreatedAt      time.Time  `json:"createdAt"`
	ReadAt         *time.Time `json:"readAt,omitempty"`
}

func toDTO(e *entity.AlexaNotificationEntity) *AlexaNotificationDTO {
	return &AlexaNotificationDTO{
		NotificationID: e.NotificationID,
		UserID:         e.UserID,
		Kind:           e.Kind,
		Title:          e.Title,
		Body:           e.Body,
		Severity:       e.Severity,
		CreatedAt:      e.CreatedAt,
		ReadAt:         e.ReadAt,
	}
}

// CreateParam 通知作成パラメータ
type CreateParam struct {
	UserID   string
	Kind     string
	Title    string
	Body     string
	Severity string
}
```

- [ ] **Step 2: サービスを作成**

```go
// ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_service.go
package alexa_notification

import (
	"fmt"
	"time"

	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
)

// AlexaNotificationService Alexa 通知サービス
type AlexaNotificationService struct {
	repo entity.AlexaNotificationRepository
}

// NewAlexaNotificationService サービスのコンストラクタ
func NewAlexaNotificationService(repo entity.AlexaNotificationRepository) *AlexaNotificationService {
	return &AlexaNotificationService{repo: repo}
}

// Create 通知を作成して保存する
func (s *AlexaNotificationService) Create(p CreateParam) (*AlexaNotificationDTO, error) {
	now := time.Now()
	n := &entity.AlexaNotificationEntity{
		NotificationID: fmt.Sprintf("%d", now.UnixNano()),
		UserID:         p.UserID,
		Kind:           p.Kind,
		Title:          p.Title,
		Body:           p.Body,
		Severity:       p.Severity,
		CreatedAt:      now,
		TTL:            now.AddDate(0, 0, 7).Unix(),
	}
	if err := s.repo.Save(n); err != nil {
		return nil, err
	}
	return toDTO(n), nil
}

// ListByUserID ユーザーの通知一覧を取得する（作成日時降順、最大50件）
func (s *AlexaNotificationService) ListByUserID(userID string) ([]*AlexaNotificationDTO, error) {
	entities, err := s.repo.FindByUserID(userID)
	if err != nil {
		return nil, err
	}
	dtos := make([]*AlexaNotificationDTO, len(entities))
	for i, e := range entities {
		dtos[i] = toDTO(e)
	}
	return dtos, nil
}

// MarkAsRead 通知を既読にする
func (s *AlexaNotificationService) MarkAsRead(notificationID string) error {
	return s.repo.MarkAsRead(notificationID)
}
```

- [ ] **Step 3: モックを使ったサービステストを作成**

```go
// ken-nao-api-legacy/src/application/alexa_notification/alexa_notification_service_test.go
package alexa_notification

import (
	"errors"
	"testing"

	entity "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
)

type mockRepo struct {
	saved    *entity.AlexaNotificationEntity
	findResp []*entity.AlexaNotificationEntity
	findErr  error
	readErr  error
}

func (m *mockRepo) Save(n *entity.AlexaNotificationEntity) error {
	m.saved = n
	return nil
}

func (m *mockRepo) FindByUserID(userID string) ([]*entity.AlexaNotificationEntity, error) {
	return m.findResp, m.findErr
}

func (m *mockRepo) MarkAsRead(notificationID string) error {
	return m.readErr
}

func TestAlexaNotificationService_Create(t *testing.T) {
	repo := &mockRepo{}
	svc := NewAlexaNotificationService(repo)

	dto, err := svc.Create(CreateParam{
		UserID:   "user-1",
		Kind:     "briefing",
		Title:    "朝のブリーフィング",
		Body:     "今日は晴れです",
		Severity: "low",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dto.UserID != "user-1" {
		t.Errorf("UserID: want user-1, got %s", dto.UserID)
	}
	if dto.Kind != "briefing" {
		t.Errorf("Kind: want briefing, got %s", dto.Kind)
	}
	if dto.NotificationID == "" {
		t.Error("NotificationID should not be empty")
	}
	if dto.ReadAt != nil {
		t.Error("new notification should not have ReadAt")
	}
	if repo.saved == nil {
		t.Error("repo.Save was not called")
	}
}

func TestAlexaNotificationService_ListByUserID_Error(t *testing.T) {
	repo := &mockRepo{findErr: errors.New("dynamo error")}
	svc := NewAlexaNotificationService(repo)

	_, err := svc.ListByUserID("user-1")
	if err == nil {
		t.Error("expected error but got nil")
	}
}

func TestAlexaNotificationService_MarkAsRead(t *testing.T) {
	repo := &mockRepo{}
	svc := NewAlexaNotificationService(repo)

	if err := svc.MarkAsRead("notif-id-123"); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go test ./src/application/alexa_notification/... -v
```

Expected: 3 テストが PASS。

- [ ] **Step 5: ビルド確認**

```bash
go build ./src/application/alexa_notification/...
```

Expected: エラーなし。

- [ ] **Step 6: commit**

```bash
git add src/application/alexa_notification/
git commit -m "feat(application): add AlexaNotification service and DTOs"
```

---

### Task 5: Controller 層 — Echo コントローラー

**Files:**
- Create: `ken-nao-api-legacy/src/presentation/controller/alexa_notification/alexa_notification_controller.go`

- [ ] **Step 1: コントローラーを作成**

```go
// ken-nao-api-legacy/src/presentation/controller/alexa_notification/alexa_notification_controller.go
package alexa_notification

import (
	"net/http"

	alexaNotificationSvc "github.com/k1e1n04/ken-nao-api-legacy/src/application/alexa_notification"
	"github.com/k1e1n04/ken-nao-api-legacy/src/shared/config"
	"github.com/labstack/echo/v4"
)

// AlexaNotificationController Alexa 通知コントローラー
type AlexaNotificationController struct {
	svc *alexaNotificationSvc.AlexaNotificationService
}

// NewAlexaNotificationController コントローラーのコンストラクタ
func NewAlexaNotificationController(svc *alexaNotificationSvc.AlexaNotificationService) *AlexaNotificationController {
	return &AlexaNotificationController{svc: svc}
}

type createRequest struct {
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Severity string `json:"severity"`
}

// Create 通知を作成する（AlexaAPIKeyMiddleware 保護）
func (ctrl *AlexaNotificationController) Create(c echo.Context) error {
	userID := c.Get(config.UserIDKey).(string)
	var req createRequest
	if err := c.Bind(&req); err != nil {
		return err
	}
	dto, err := ctrl.svc.Create(alexaNotificationSvc.CreateParam{
		UserID:   userID,
		Kind:     req.Kind,
		Title:    req.Title,
		Body:     req.Body,
		Severity: req.Severity,
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, dto)
}

// List 通知一覧を取得する（JWTAuthMiddleware 保護）
func (ctrl *AlexaNotificationController) List(c echo.Context) error {
	userID := c.Get(config.UserIDKey).(string)
	dtos, err := ctrl.svc.ListByUserID(userID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, dtos)
}

// MarkAsRead 通知を既読にする（JWTAuthMiddleware 保護）
func (ctrl *AlexaNotificationController) MarkAsRead(c echo.Context) error {
	id := c.Param("id")
	if err := ctrl.svc.MarkAsRead(id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go build ./src/presentation/controller/alexa_notification/...
```

Expected: エラーなし。

- [ ] **Step 3: commit**

```bash
git add src/presentation/controller/alexa_notification/
git commit -m "feat(controller): add AlexaNotification Echo controller"
```

---

### Task 6: Routes + DI 配線

**Files:**
- Modify: `ken-nao-api-legacy/src/presentation/routes/routes.go`
- Modify: `ken-nao-api-legacy/src/di/di.go`

- [ ] **Step 1: `routes.go` にインポートと関数を追加**

`src/presentation/routes/routes.go` のインポートブロックに追加：

```go
	alexanotification "github.com/k1e1n04/ken-nao-api-legacy/src/presentation/controller/alexa_notification"
```

`InitRoutes` 関数の末尾（`registerLifePlanRoutes` の後）に追加：

```go
	registerAlexaNotificationRoutes(ag, container)
```

ファイル末尾に関数を追加：

```go
// registerAlexaNotificationRoutes は Alexa 通知のルーティングを登録
func registerAlexaNotificationRoutes(ag *echo.Group, container *dig.Container) {
	var nc *alexanotification.AlexaNotificationController
	err := container.Invoke(func(c *alexanotification.AlexaNotificationController) {
		nc = c
	})
	if err != nil {
		panic(err)
	}

	// Alexa Lambda が通知を書き込む（APIキー認証）
	alexaG := ag.Group("/alexa/notifications")
	alexaG.Use(middleware.AlexaAPIKeyMiddleware)
	alexaG.POST("", nc.Create)

	// フロントエンドが通知を読む（JWT認証）
	userG := ag.Group("/alexa/notifications")
	userG.Use(middleware.JWTAuthMiddleware)
	userG.GET("", nc.List)
	userG.PUT("/:id/read", nc.MarkAsRead)
}
```

- [ ] **Step 2: `di.go` にインポートを追加**

`src/di/di.go` のインポートブロックに以下を追加：

```go
	alexanotificationdomain "github.com/k1e1n04/ken-nao-api-legacy/src/domain/alexa_notification"
	alexanotificationpersist "github.com/k1e1n04/ken-nao-api-legacy/src/infrastructure/persistence/alexa_notification"
	alexanotification2 "github.com/k1e1n04/ken-nao-api-legacy/src/application/alexa_notification"
	alexanotification3 "github.com/k1e1n04/ken-nao-api-legacy/src/presentation/controller/alexa_notification"
```

- [ ] **Step 3: `di.go` の `registerRepository` にリポジトリを追加**

`registerRepository` の `providers` スライスの末尾（`}` の前）に追加：

```go
		func(db *dynamodb.Client) alexanotificationdomain.AlexaNotificationRepository {
			return alexanotificationpersist.NewAlexaNotificationRepository(db)
		},
```

- [ ] **Step 4: `di.go` の `registerService` にサービスを追加**

`registerService` 末尾の `return nil` の直前に追加：

```go
	if err := c.Provide(func(repo alexanotificationdomain.AlexaNotificationRepository) *alexanotification2.AlexaNotificationService {
		return alexanotification2.NewAlexaNotificationService(repo)
	}); err != nil {
		return err
	}
```

- [ ] **Step 5: `di.go` の `registerController` にコントローラーを追加**

`registerController` の `providers` スライスの末尾（`}` の前）に追加：

```go
		func(s *alexanotification2.AlexaNotificationService) *alexanotification3.AlexaNotificationController {
			return alexanotification3.NewAlexaNotificationController(s)
		},
```

- [ ] **Step 6: ビルドして全体確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go build ./...
```

Expected: エラーなし。

- [ ] **Step 7: 全テスト実行**

```bash
go test ./... 2>&1 | tail -20
```

Expected: 既存テストも含め全て PASS（または SKIP）。

- [ ] **Step 8: commit**

```bash
git add src/presentation/routes/routes.go src/di/di.go
git commit -m "feat(routes, di): wire AlexaNotification routes and DI"
```

---

### Task 7: フロントエンド — 通知ページ + コンポーネント

**Files:**
- Modify: `ken-nao-frontend/src/constants/views.ts`
- Modify: `ken-nao-frontend/src/templates/LayoutComponent.tsx`
- Create: `ken-nao-frontend/src/app/(authenticated)/notifications/page.tsx`
- Create: `ken-nao-frontend/src/app/(authenticated)/notifications/fetcher.ts`
- Create: `ken-nao-frontend/src/app/(authenticated)/notifications/_organisms/NotificationList.tsx`
- Create: `ken-nao-frontend/src/app/(authenticated)/notifications/_organisms/NotificationCard.tsx`
- Create: `ken-nao-frontend/src/app/(authenticated)/notifications/_actions/markAsRead.ts`

- [ ] **Step 1: `views.ts` に通知ページを追加**

`src/constants/views.ts` の `} as const;` の直前に追加：

```typescript
  ALEXA_NOTIFICATIONS: {
    path: "/notifications",
    name: "チャッピーからのお知らせ",
  },
```

- [ ] **Step 2: `LayoutComponent.tsx` にナビゲーション項目を追加**

`LayoutComponent.tsx` のインポートに `BellIcon` を追加：

```typescript
import {
  BanknotesIcon,
  BellIcon,
  BriefcaseIcon,
  CalculatorIcon,
  ChartBarSquareIcon,
  Cog6ToothIcon,
  ListBulletIcon,
  ShoppingCartIcon,
} from "@heroicons/react/24/outline";
```

`drawerSections` の先頭（`WantToDo` セクションの前）に追加：

```typescript
    {
      title: "チャッピー",
      items: [
        {
          name: views.ALEXA_NOTIFICATIONS.name,
          path: views.ALEXA_NOTIFICATIONS.path,
          icon: <BellIcon className="w-6 h-6" />,
        },
      ],
    },
```

- [ ] **Step 3: 型定義とフェッチャーを作成**

```typescript
// ken-nao-frontend/src/app/(authenticated)/notifications/fetcher.ts
import "server-only";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { views } from "@/constants/views";

export type AlexaNotification = {
  notificationId: string;
  userId: string;
  kind: "briefing" | "reminder" | "task-result" | "alert";
  title: string;
  body: string;
  severity: "low" | "mid" | "high" | "critical";
  createdAt: string;
  readAt?: string;
};

export const fetchAlexaNotifications = async (): Promise<AlexaNotification[]> => {
  const session = await auth();
  if (!session?.user?.accessToken) {
    redirect(views.LOGIN.path);
  }

  const baseUrl = process.env.NEXT_API_BASE_URL;
  const apiKey = process.env.NEXT_APIGATEWAY_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("API設定エラー: 環境変数が設定されていません");
  }

  const res = await fetch(`${baseUrl}/alexa/notifications`, {
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      Authorization: `Bearer ${session.user.accessToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`通知の取得に失敗しました: ${res.status}`);
  }

  return res.json() as Promise<AlexaNotification[]>;
};
```

- [ ] **Step 4: 既読アクションを作成**

```typescript
// ken-nao-frontend/src/app/(authenticated)/notifications/_actions/markAsRead.ts
"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { views } from "@/constants/views";

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  const session = await auth();
  if (!session?.user?.accessToken) {
    redirect(views.LOGIN.path);
  }

  const baseUrl = process.env.NEXT_API_BASE_URL;
  const apiKey = process.env.NEXT_APIGATEWAY_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("API設定エラー: 環境変数が設定されていません");
  }

  const res = await fetch(`${baseUrl}/alexa/notifications/${notificationId}/read`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      Authorization: `Bearer ${session.user.accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`既読にする処理に失敗しました: ${res.status}`);
  }
};
```

- [ ] **Step 5: NotificationCard コンポーネントを作成**

```tsx
// ken-nao-frontend/src/app/(authenticated)/notifications/_organisms/NotificationCard.tsx
"use client";

import { useState } from "react";
import { BellIcon, CheckIcon } from "@heroicons/react/24/outline";
import type { AlexaNotification } from "../fetcher";
import { markNotificationAsRead } from "../_actions/markAsRead";

type Props = {
  notification: AlexaNotification;
};

const severityColor: Record<string, string> = {
  low: "border-l-gray-400",
  mid: "border-l-blue-400",
  high: "border-l-orange-400",
  critical: "border-l-red-500",
};

const kindLabel: Record<string, string> = {
  briefing: "ブリーフィング",
  reminder: "リマインダー",
  "task-result": "タスク完了",
  alert: "アラート",
};

export const NotificationCard: React.FC<Props> = ({ notification }) => {
  const [read, setRead] = useState(!!notification.readAt);
  const [loading, setLoading] = useState(false);

  const handleMarkAsRead = async () => {
    if (read || loading) return;
    setLoading(true);
    try {
      await markNotificationAsRead(notification.notificationId);
      setRead(true);
    } finally {
      setLoading(false);
    }
  };

  const createdAt = new Date(notification.createdAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`border-l-4 ${severityColor[notification.severity] ?? "border-l-gray-300"} bg-white dark:bg-gray-800 rounded-r-lg p-4 shadow-sm ${read ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <BellIcon className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">{kindLabel[notification.kind] ?? notification.kind}</span>
              {!read && (
                <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">未読</span>
              )}
            </div>
            <p className="font-medium text-gray-900 dark:text-gray-100 mt-1 text-sm">{notification.title}</p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1 whitespace-pre-wrap">{notification.body}</p>
            <p className="text-xs text-gray-400 mt-2">{createdAt}</p>
          </div>
        </div>
        {!read && (
          <button
            onClick={handleMarkAsRead}
            disabled={loading}
            className="shrink-0 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            title="既読にする"
          >
            <CheckIcon className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 6: NotificationList コンポーネントを作成**

```tsx
// ken-nao-frontend/src/app/(authenticated)/notifications/_organisms/NotificationList.tsx
import type { AlexaNotification } from "../fetcher";
import { NotificationCard } from "./NotificationCard";

type Props = {
  notifications: AlexaNotification[];
};

export const NotificationList: React.FC<Props> = ({ notifications }) => {
  if (notifications.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>チャッピーからのお知らせはありません</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notifications.map((n) => (
        <NotificationCard key={n.notificationId} notification={n} />
      ))}
    </div>
  );
};
```

- [ ] **Step 7: ページを作成**

```tsx
// ken-nao-frontend/src/app/(authenticated)/notifications/page.tsx
import { type Metadata } from "next";
import { fetchAlexaNotifications } from "./fetcher";
import { NotificationList } from "./_organisms/NotificationList";

export const metadata: Metadata = {
  title: "チャッピーからのお知らせ | PairPanel",
  description: "チャッピーから届いた通知を確認できます",
};

export default async function NotificationsPage() {
  const notifications = await fetchAlexaNotifications();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        チャッピーからのお知らせ
      </h1>
      <NotificationList notifications={notifications} />
    </div>
  );
}
```

- [ ] **Step 8: TypeScript ビルド確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-frontend
npx tsc --noEmit 2>&1 | tail -20
```

Expected: エラーなし。

- [ ] **Step 9: commit**

```bash
cd /Users/ishiiken/Develop/ken-nao
git add \
  ken-nao-frontend/src/constants/views.ts \
  ken-nao-frontend/src/templates/LayoutComponent.tsx \
  ken-nao-frontend/src/app/\(authenticated\)/notifications/
git commit -m "feat(frontend): add Alexa notifications page"
```

---

### Task 8: デプロイ + スモークテスト

**Files:** なし（インフラ操作のみ）

- [ ] **Step 1: Go API をビルドして PRD にデプロイ**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-api-legacy
go build ./...
```

Expected: エラーなし。

PRD にデプロイするコマンドはプロジェクトの CI/CD フローに従う（例: `make deploy-prd` またはコンテナビルド → ECR push → ECS デプロイ）。

- [ ] **Step 2: API ヘルスチェック**

```bash
curl -s \
  -H "X-Api-Key: ${PAIRPANEL_API_GATEWAY_KEY}" \
  "${PAIRPANEL_API_URL}/api/v1/healthcheck"
```

Expected: `OK` が返る。

- [ ] **Step 3: 通知作成スモークテスト（AlexaAPIKeyMiddleware）**

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: ${PAIRPANEL_API_GATEWAY_KEY}" \
  -H "X-User-Id: ${PAIRPANEL_USER_ID}" \
  -d '{"kind":"briefing","title":"テスト通知","body":"Plan C のスモークテストです","severity":"low"}' \
  "${PAIRPANEL_API_URL}/api/v1/alexa/notifications"
```

Expected: HTTP 201 + `{"notificationId":"...","kind":"briefing",...}` が返る。

- [ ] **Step 4: 通知一覧取得スモークテスト（JWTAuthMiddleware）**

```bash
curl -s \
  -H "X-Api-Key: ${PAIRPANEL_API_GATEWAY_KEY}" \
  -H "Authorization: Bearer ${PAIRPANEL_JWT_TOKEN}" \
  "${PAIRPANEL_API_URL}/api/v1/alexa/notifications"
```

Expected: HTTP 200 + 配列（Step 3 で作成した通知を含む）が返る。

- [ ] **Step 5: 既読スモークテスト**

Step 3 で返ってきた `notificationId` を使う：

```bash
curl -s -X PUT \
  -H "X-Api-Key: ${PAIRPANEL_API_GATEWAY_KEY}" \
  -H "Authorization: Bearer ${PAIRPANEL_JWT_TOKEN}" \
  "${PAIRPANEL_API_URL}/api/v1/alexa/notifications/${NOTIFICATION_ID}/read"
```

Expected: HTTP 204 が返る。

- [ ] **Step 6: フロントエンドビルド確認**

```bash
cd /Users/ishiiken/Develop/ken-nao/ken-nao-frontend
npm run build 2>&1 | tail -20
```

Expected: ビルドエラーなし。`/notifications` ページが静的生成または SSR として含まれる。

- [ ] **Step 7: alexa-chatgpt の `pairpanel.ts` に `postNotification` を追加**（Plan A の実装が済んでいない場合のみ）

Plan A で既に実装済みのはずだが、未実装の場合は `lambda/src/services/pairpanel.ts` に追加：

```typescript
export interface PairpanelNotification {
  kind: "briefing" | "reminder" | "task-result" | "alert";
  title: string;
  body: string;
  severity: "low" | "mid" | "high" | "critical";
  expiresAt?: string;
}

export async function postNotification(notification: PairpanelNotification): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/alexa/notifications`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.warn(`[pairpanel] postNotification failed: ${res.status}`);
  }
}
```

- [ ] **Step 8: 最終 commit**

```bash
cd /Users/ishiiken/Develop/ken-nao
git add -A
git status
# 変更なければスキップ
git commit -m "chore: Plan C smoke tests verified" --allow-empty
```

---

## 実装後の確認チェックリスト

- [ ] DynamoDB テーブル `prd-alexa_notifications` が PRD に存在する
- [ ] `POST /api/v1/alexa/notifications`（AlexaAPIKeyMiddleware）が 201 を返す
- [ ] `GET /api/v1/alexa/notifications`（JWTAuthMiddleware）が 200 + 配列を返す
- [ ] `PUT /api/v1/alexa/notifications/:id/read`（JWTAuthMiddleware）が 204 を返す
- [ ] pairpanel フロントエンドの `/notifications` ページが表示される
- [ ] 通知カードに Kind・Title・Body・日時が表示される
- [ ] 既読ボタンを押すと通知がグレーアウトされる
- [ ] TTL: 通知は 7 日後に自動削除される
