package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"goland/internal/auth"
	"goland/internal/config"
	"goland/internal/files"
	"goland/internal/git"
	"goland/internal/server"
	"goland/internal/store"
	"goland/internal/workspace"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration error", "err", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	cancel()
	if err != nil {
		logger.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = st.Disconnect(shutdownCtx)
	}()

	if err := server.BootstrapAdmin(context.Background(), st, cfg); err != nil {
		logger.Error("bootstrap admin failed", "err", err)
		os.Exit(1)
	}

	wm, err := workspace.New(cfg, st)
	if err != nil {
		logger.Error("workspace manager failed", "err", err)
		os.Exit(1)
	}
	if wm.IsolationEnabled() {
		logger.Info("workspace Unix isolation enabled")
		if err := wm.PrepareAll(context.Background()); err != nil {
			logger.Warn("workspace preparation incomplete", "err", err)
		}
	} else {
		logger.Warn("workspace Unix isolation disabled; workspace processes run with backend privileges")
	}
	authManager := auth.NewManager(st, cfg.SessionTTL, cfg.SecureCookies)
	handler := server.New(cfg, st, authManager, wm, files.New(wm), git.New(wm), logger)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // WebSockets and streamed command output need long-lived writes.
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info("goland server listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}
