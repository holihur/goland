package plugins

import (
	"encoding/json"
	"testing"
)

func TestEncodeDecodeRequest(t *testing.T) {
	id := int64(7)
	data, err := EncodeRequest(&id, MethodCommand, CommandRequest{
		RequestID: "r1",
		CommandID: "demo.plugin.hello",
		Inputs:    map[string]any{"name": "x"},
	})
	if err != nil {
		t.Fatal(err)
	}
	req, err := DecodeRequest(data)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != MethodCommand || req.ID == nil || *req.ID != 7 {
		t.Fatalf("unexpected request: %+v", req)
	}
	var params CommandRequest
	if err := DecodeParams(req, &params); err != nil {
		t.Fatal(err)
	}
	if params.RequestID != "r1" || params.Inputs["name"] != "x" {
		t.Fatalf("unexpected params: %+v", params)
	}

	notification, err := EncodeRequest(nil, NotifyOutput, OutputNotification{RequestID: "r1", Chunk: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	req, err = DecodeRequest(notification)
	if err != nil {
		t.Fatal(err)
	}
	if req.ID != nil {
		t.Fatal("notification should not carry an id")
	}

	for name, payload := range map[string]string{
		"empty object":   `{}`,
		"bad version":    `{"jsonrpc":"1.0","method":"x"}`,
		"no method":      `{"jsonrpc":"2.0"}`,
		"unknown field":  `{"jsonrpc":"2.0","method":"x","extra":1}`,
		"trailing value": `{"jsonrpc":"2.0","method":"x"}{}`,
		"bad json":       `{`,
	} {
		if _, err := DecodeRequest([]byte(payload)); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
}

func TestDecodeParamsStrict(t *testing.T) {
	req := &RPCRequest{Method: MethodHookSave, Params: json.RawMessage(`{"requestId":"r","kind":"onSave","path":"a.go","extra":1}`)}
	var params HookRequest
	if err := DecodeParams(req, &params); err == nil {
		t.Fatal("unknown params field accepted")
	}
	req.Params = json.RawMessage(`{"requestId":"r","kind":"onSave","path":"a.go"}`)
	if err := DecodeParams(req, &params); err != nil {
		t.Fatal(err)
	}
	req.Params = nil
	if err := DecodeParams(req, &params); err != nil {
		t.Fatal(err)
	}
	req.Params = json.RawMessage(`{} {}`)
	if err := DecodeParams(req, &params); err == nil {
		t.Fatal("multiple params objects accepted")
	}
}

func TestDecodeResponse(t *testing.T) {
	valid, _ := json.Marshal(RPCResponse{JSONRPC: JSONRPCVersion, ID: intPtr(1), Result: json.RawMessage(`{"status":"ok"}`)})
	resp, err := DecodeResponse(valid)
	if err != nil {
		t.Fatal(err)
	}
	if string(resp.Result) != `{"status":"ok"}` {
		t.Fatalf("unexpected response: %+v", resp)
	}

	for name, payload := range map[string]string{
		"bad version":  `{"jsonrpc":"1.0","id":1}`,
		"missing id":   `{"jsonrpc":"2.0"}`,
		"both":         `{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"x"}}`,
		"invalid json": `{`,
	} {
		if _, err := DecodeResponse([]byte(payload)); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
	if (&RPCError{Code: 5, Message: "boom"}).Error() == "" {
		t.Fatal("missing error string")
	}
	if (*RPCError)(nil).Error() != "" {
		t.Fatal("nil error should format as empty")
	}
}

func intPtr(value int64) *int64 { return &value }
