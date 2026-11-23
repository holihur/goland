package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"goland/internal/store"
	taskpkg "goland/internal/tasks"
)

func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	list, err := taskpkg.Discover(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tasks_failed", "could not discover tasks")
		return
	}
	if list == nil {
		list = []taskpkg.Task{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": list})
}

func (s *Server) taskRuns(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	runs, err := s.store.ListTaskRuns(r.Context(), ws.OwnerID, ws.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list task runs")
		return
	}
	if runs == nil {
		runs = []store.TaskRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) taskWS(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	taskID := r.URL.Query().Get("task")
	task, err := taskpkg.Find(root, taskID)
	if err != nil {
		writeError(w, http.StatusNotFound, "task_not_found", "task not found")
		return
	}
	if !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin", "websocket origin is not allowed")
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 << 10)

	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": "could not prepare workspace user: " + err.Error()})
		return
	}
	runCtx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, task.Command, task.Args...)
	cmd.Dir = root
	cmd.Env = identity.Env(root)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	identity.Apply(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": err.Error()})
		return
	}
	record := &store.TaskRun{
		WorkspaceID: ws.ID, OwnerID: ws.OwnerID, Kind: task.Kind,
		Command: task.Command + " " + strings.Join(task.Args, " "), Status: "running",
	}
	if err := s.store.CreateTaskRun(r.Context(), record); err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": "could not record task run"})
		return
	}
	if err := cmd.Start(); err != nil {
		record.Status = "failed"
		record.Output = err.Error()
		now := time.Now().UTC()
		record.FinishedAt = &now
		_ = s.store.UpdateTaskRun(context.Background(), record)
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": err.Error()})
		return
	}
	s.audit(r, "task.run", ws.ID.Hex(), task.ID)
	go func() {
		<-runCtx.Done()
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
	}()

	type chunk struct {
		stream string
		data   string
	}
	chunks := make(chan chunk, 128)
	var readers sync.WaitGroup
	read := func(reader io.Reader, stream string) {
		defer readers.Done()
		buffered := bufio.NewReaderSize(reader, 32<<10)
		buffer := make([]byte, 16<<10)
		for {
			n, err := buffered.Read(buffer)
			if n > 0 {
				chunks <- chunk{stream: stream, data: string(buffer[:n])}
			}
			if err != nil {
				return
			}
		}
	}
	readers.Add(2)
	go read(stdout, "stdout")
	go read(stderr, "stderr")
	go func() {
		readers.Wait()
		close(chunks)
	}()

	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()

	clientDone := make(chan struct{})
	var clientOnce sync.Once
	closeClient := func() {
		clientOnce.Do(func() { close(clientDone); cancel() })
	}
	go func() {
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				closeClient()
				return
			}
			var msg struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(payload, &msg) == nil && msg.Type == "cancel" {
				closeClient()
				return
			}
		}
	}()

	var output strings.Builder
	const maxOutput = 2 << 20
	var waitErr error
	runDone := runCtx.Done()
	_ = conn.WriteJSON(map[string]any{"type": "started", "runId": record.ID.Hex(), "task": task})
	var writeMu sync.Mutex
	send := func(v any) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.WriteJSON(v)
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case item, ok := <-chunks:
			if !ok {
				status := "success"
				exitCode := 0
				if waitErr != nil {
					status = "failed"
					var exitErr *exec.ExitError
					if errors.As(waitErr, &exitErr) {
						exitCode = exitErr.ExitCode()
					} else {
						exitCode = -1
					}
				}
				if runCtx.Err() != nil {
					status = "cancelled"
				}
				record.Status, record.ExitCode, record.Output = status, exitCode, output.String()
				now := time.Now().UTC()
				record.FinishedAt = &now
				saveCtx, saveCancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = s.store.UpdateTaskRun(saveCtx, record)
				saveCancel()
				send(map[string]any{"type": "exit", "status": status, "exitCode": exitCode, "runId": record.ID.Hex()})
				return
			}
			data := item.data
			if output.Len() < maxOutput {
				remain := maxOutput - output.Len()
				if len(data) > remain {
					data = data[:remain] + "\n[output truncated]\n"
				}
				output.WriteString(data)
			}
			send(map[string]any{"type": "output", "stream": item.stream, "data": item.data})
		case <-heartbeat.C:
			send(map[string]string{"type": "ping"})
		case err := <-waitCh:
			waitErr = err
			waitCh = nil
		case <-clientDone:
			cancel()
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			record.Status = "cancelled"
			record.ExitCode = -1
			record.Output = output.String()
			now := time.Now().UTC()
			record.FinishedAt = &now
			saveCtx, saveCancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = s.store.UpdateTaskRun(saveCtx, record)
			saveCancel()
			send(map[string]any{"type": "exit", "status": "cancelled", "exitCode": -1, "runId": record.ID.Hex()})
			return
		case <-runDone:
			// The process is killed by CommandContext; wait for the pipe close
			// path to persist the cancelled run.
			runDone = nil
		}
	}
}
