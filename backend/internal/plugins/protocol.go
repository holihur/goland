package plugins

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// JSON-RPC 2.0 method names used between the host and plugin processes.
const (
	MethodInitialize = "initialize"
	MethodHealth     = "health"
	MethodShutdown   = "shutdown"
	MethodCommand    = "command/execute"
	MethodCancel     = "command/cancel"
	MethodHookOpen   = "hook/onOpen"
	MethodHookSave   = "hook/onSave"
	MethodPreCommit  = "hook/preCommit"
	MethodPostPull   = "hook/postPull"

	NotifyOutput   = "command/output"
	NotifyStatus   = "ui/status"
	NotifyPanel    = "ui/panel"
	NotifyNotify   = "ui/notify"
	NotifyLog      = "log"
	NotifyCancel   = "plugin/cancel"
	JSONRPCVersion = "2.0"
)

// RPCRequest is a JSON-RPC 2.0 request or notification.
type RPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// RPCResponse is a JSON-RPC 2.0 response.
type RPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError is a JSON-RPC 2.0 error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("plugin rpc error %d: %s", e.Code, e.Message)
}

// Protocol request/notification payloads.
type InitializeParams struct {
	APIVersion  int            `json:"apiVersion"`
	WorkspaceID string         `json:"workspaceId"`
	RootPath    string         `json:"rootPath"`
	Config      map[string]any `json:"config,omitempty"`
}

type InitializeResult struct {
	Name         string         `json:"name,omitempty"`
	Version      string         `json:"version,omitempty"`
	Capabilities map[string]any `json:"capabilities,omitempty"`
}

type HealthResult struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type CommandRequest struct {
	RequestID string         `json:"requestId"`
	CommandID string         `json:"commandId"`
	Args      []string       `json:"args,omitempty"`
	Inputs    map[string]any `json:"inputs,omitempty"`
	Path      string         `json:"path,omitempty"`
	Selection *Selection     `json:"selection,omitempty"`
}

type CommandResult struct {
	Output string `json:"output,omitempty"`
	Result any    `json:"result,omitempty"`
}

type Selection struct {
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	Text        string `json:"text,omitempty"`
}

type HookRequest struct {
	RequestID string         `json:"requestId"`
	Kind      string         `json:"kind"`
	Path      string         `json:"path"`
	Content   string         `json:"content,omitempty"`
	Selection *Selection     `json:"selection,omitempty"`
	Branch    string         `json:"branch,omitempty"`
	Files     []string       `json:"files,omitempty"`
	DiffStat  string         `json:"diffStat,omitempty"`
	Message   string         `json:"message,omitempty"`
	Existing  string         `json:"existing,omitempty"`
	Inputs    map[string]any `json:"inputs,omitempty"`
}

type HookResult struct {
	Allow    bool           `json:"allow"`
	Message  string         `json:"message,omitempty"`
	Content  *string        `json:"content,omitempty"`
	Notes    []string       `json:"notes,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type OutputNotification struct {
	RequestID string `json:"requestId"`
	Chunk     string `json:"chunk"`
}

type StatusNotification struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	Tooltip string `json:"tooltip,omitempty"`
}

type PanelNotification struct {
	PanelID string         `json:"panelId"`
	Title   string         `json:"title,omitempty"`
	State   map[string]any `json:"state,omitempty"`
	Output  string         `json:"output,omitempty"`
}

type NotifyNotification struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type LogNotification struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type CancelNotification struct {
	RequestID string `json:"requestId"`
}

// EncodeRequest builds a JSON-RPC request with an optional ID.
func EncodeRequest(id *int64, method string, params any) ([]byte, error) {
	req := RPCRequest{JSONRPC: JSONRPCVersion, ID: id, Method: method}
	if params != nil {
		raw, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		req.Params = raw
	}
	return json.Marshal(req)
}

// DecodeRequest parses a JSON-RPC request or notification strictly.
func DecodeRequest(data []byte) (*RPCRequest, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var req RPCRequest
	if err := dec.Decode(&req); err != nil {
		return nil, fmt.Errorf("decode rpc request: %w", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("rpc request must contain a single JSON object")
	}
	if req.JSONRPC != JSONRPCVersion {
		return nil, fmt.Errorf("unsupported jsonrpc version %q", req.JSONRPC)
	}
	if req.Method == "" {
		return nil, errors.New("rpc method is required")
	}
	return &req, nil
}

// DecodeParams decodes params into dst with unknown-field rejection.
func DecodeParams(req *RPCRequest, dst any) error {
	if len(req.Params) == 0 || string(req.Params) == "null" {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(req.Params))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%s params: %w", req.Method, err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%s params must contain a single JSON object", req.Method)
	}
	return nil
}

// DecodeResponse parses a JSON-RPC response strictly.
func DecodeResponse(data []byte) (*RPCResponse, error) {
	var resp RPCResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("decode rpc response: %w", err)
	}
	if resp.JSONRPC != JSONRPCVersion {
		return nil, fmt.Errorf("unsupported jsonrpc version %q", resp.JSONRPC)
	}
	if resp.ID == nil {
		return nil, errors.New("rpc response id is required")
	}
	if resp.Error != nil && len(resp.Result) > 0 {
		return nil, errors.New("rpc response cannot contain both result and error")
	}
	return &resp, nil
}
