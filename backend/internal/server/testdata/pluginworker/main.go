// Command pluginworker is a test fixture speaking LSP or DAP over stdio with
// Content-Length framing. It is built by the plugin integration tests.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

type message struct {
	ID        *int64          `json:"id,omitempty"`
	Method    string          `json:"method,omitempty"`
	Command   string          `json:"command,omitempty"`
	Type      string          `json:"type,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

func main() {
	mode := flag.String("mode", "lsp", "lsp or dap")
	flag.Parse()
	reader := bufio.NewReaderSize(os.Stdin, 1<<20)
	for {
		body, err := readFrame(reader)
		if err != nil {
			return
		}
		var msg message
		if err := json.Unmarshal(body, &msg); err != nil {
			continue
		}
		if *mode == "lsp" || msg.Method != "" {
			handleLSP(msg)
		} else {
			handleDAP(msg)
		}
	}
}

func handleLSP(msg message) {
	switch msg.Method {
	case "initialize":
		respond(msg.ID, map[string]any{"capabilities": map[string]any{"textDocumentSync": 1}})
	case "textDocument/didOpen":
		var params struct {
			TextDocument struct {
				URI string `json:"uri"`
			} `json:"textDocument"`
		}
		_ = json.Unmarshal(msg.Params, &params)
		notify("textDocument/publishDiagnostics", map[string]any{
			"uri": params.TextDocument.URI,
			"diagnostics": []map[string]any{{
				"range": map[string]any{
					"start": map[string]int{"line": 0, "character": 0},
					"end":   map[string]int{"line": 0, "character": 1},
				},
				"severity": 1,
				"message":  "plugin diagnostic",
			}},
		})
	case "shutdown":
		respond(msg.ID, nil)
	}
}

func handleDAP(msg message) {
	command := msg.Command
	switch command {
	case "initialize":
		respondDAP(msg.ID, command, map[string]any{"supportsConfigurationDoneRequest": true})
	case "setBreakpoints":
		respondDAP(msg.ID, command, map[string]any{"breakpoints": []map[string]any{{"verified": true, "line": 6}}})
	case "setExceptionBreakpoints":
		respondDAP(msg.ID, command, nil)
	case "launch":
		respondDAP(msg.ID, command, nil)
		notifyDAP("initialized", map[string]any{})
		notifyDAP("stopped", map[string]any{"reason": "breakpoint", "threadId": 1})
	case "configurationDone":
		respondDAP(msg.ID, command, nil)
	case "threads":
		respondDAP(msg.ID, command, map[string]any{"threads": []map[string]any{{"id": 1, "name": "main"}}})
	case "stackTrace":
		respondDAP(msg.ID, command, map[string]any{"stackFrames": []map[string]any{{
			"id": 7, "name": "main.add", "line": 6, "column": 1,
		}}})
	case "scopes":
		respondDAP(msg.ID, command, map[string]any{"scopes": []map[string]any{{
			"name": "Locals", "variablesReference": 42, "expensive": false,
		}}})
	case "variables":
		respondDAP(msg.ID, command, map[string]any{"variables": []map[string]any{{
			"name": "a", "value": "2", "type": "int", "variablesReference": 0,
		}}})
	case "continue":
		respondDAP(msg.ID, command, map[string]any{"allThreadsContinued": true})
		notifyDAP("terminated", map[string]any{})
	case "disconnect", "terminate":
		respondDAP(msg.ID, command, nil)
	}
}

func respondDAP(id *int64, command string, body any) {
	writeJSON(map[string]any{
		"seq": 1, "type": "response", "request_seq": id,
		"success": true, "command": command, "body": body,
	})
}

func respond(id *int64, result any) {
	writeJSON(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func notify(method string, params any) {
	writeJSON(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func notifyDAP(event string, body any) {
	writeJSON(map[string]any{"jsonrpc": "2.0", "type": "event", "event": event, "body": body})
}

func writeJSON(value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	fmt.Printf("Content-Length: %d\r\n\r\n%s", len(data), data)
}

func readFrame(reader *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			parsed, err := strconv.Atoi(strings.TrimSpace(line[len("content-length:"):]))
			if err != nil || parsed < 0 || parsed > 16<<20 {
				return nil, io.ErrUnexpectedEOF
			}
			length = parsed
		}
	}
	if length < 0 {
		return nil, io.ErrUnexpectedEOF
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}
