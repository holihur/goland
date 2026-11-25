package config

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                     string
	MongoURI                 string
	MongoDB                  string
	WorkspaceRoots           []string
	DataDir                  string
	SessionTTL               time.Duration
	AdminEmail               string
	AdminPassword            string
	AdminName                string
	MasterKey                []byte
	SecureCookies            bool
	MFARequired              bool
	PublicURL                string
	OIDCIssuer               string
	OIDCClientID             string
	OIDCClientSecret         string
	OIDCRedirectURL          string
	OIDCProviderName         string
	OIDCScopes               []string
	OIDCAutoCreate           bool
	OIDCTrustMFA             bool
	OIDCRequireVerifiedEmail bool
	WebDist                  string
	AllowedOrigins           []string
	Isolation                string
	DevPermissions           bool

	GoPLS    string
	TSServer string
	DLV      string
	Node     string
	JsDebug  string
	Chrome   string
}

func Load() (*Config, error) {
	c := &Config{
		Addr:                     env("GOLAND_ADDR", "127.0.0.1:8788"),
		MongoURI:                 env("GOLAND_MONGO_URI", "mongodb://127.0.0.1:27019"),
		MongoDB:                  env("GOLAND_MONGO_DB", "goland"),
		DataDir:                  env("GOLAND_DATA_DIR", ".data"),
		SessionTTL:               168 * time.Hour,
		AdminEmail:               strings.ToLower(env("GOLAND_ADMIN_EMAIL", "admin@goland.local")),
		AdminPassword:            env("GOLAND_ADMIN_PASSWORD", "admin123456"),
		AdminName:                env("GOLAND_ADMIN_NAME", "Administrator"),
		SecureCookies:            envBool("GOLAND_SECURE_COOKIES", false),
		MFARequired:              envBool("GOLAND_MFA_REQUIRED", false),
		PublicURL:                strings.TrimRight(env("GOLAND_PUBLIC_URL", ""), "/"),
		OIDCIssuer:               strings.TrimRight(env("GOLAND_OIDC_ISSUER", ""), "/"),
		OIDCClientID:             env("GOLAND_OIDC_CLIENT_ID", ""),
		OIDCClientSecret:         env("GOLAND_OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURL:          strings.TrimSpace(env("GOLAND_OIDC_REDIRECT_URL", "")),
		OIDCProviderName:         env("GOLAND_OIDC_NAME", "Single sign-on"),
		OIDCScopes:               splitCSV(env("GOLAND_OIDC_SCOPES", "openid,profile,email")),
		OIDCAutoCreate:           envBool("GOLAND_OIDC_AUTO_CREATE", false),
		OIDCTrustMFA:             envBool("GOLAND_OIDC_TRUST_MFA", true),
		OIDCRequireVerifiedEmail: envBool("GOLAND_OIDC_REQUIRE_VERIFIED_EMAIL", true),
		WebDist:                  env("GOLAND_WEB_DIST", ""),
		AllowedOrigins:           splitCSV(env("GOLAND_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")),
		Isolation:                env("GOLAND_ISOLATION", "auto"),
		DevPermissions:           envBool("GOLAND_DEV_PERMISSIONS", false),
		GoPLS:                    env("GOLAND_GOPLS", "gopls"),
		TSServer:                 env("GOLAND_TSSERVER", "typescript-language-server"),
		DLV:                      env("GOLAND_DLV", "dlv"),
		Node:                     env("GOLAND_NODE", "node"),
		JsDebug:                  env("GOLAND_JS_DEBUG", ""),
		Chrome:                   env("GOLAND_CHROME", "chromium"),
	}
	if v := env("GOLAND_SESSION_TTL", ""); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid GOLAND_SESSION_TTL: %q", v)
		}
		c.SessionTTL = d
	}

	dataDir, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.DataDir = dataDir
	if err := os.MkdirAll(c.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if c.WebDist != "" {
		if abs, err := filepath.Abs(c.WebDist); err == nil {
			c.WebDist = abs
		}
	}
	if c.JsDebug == "" {
		for _, candidate := range []string{"deploy/js-debug/src/dapDebugServer.js", "../deploy/js-debug/src/dapDebugServer.js"} {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				c.JsDebug, _ = filepath.Abs(candidate)
				break
			}
		}
	} else if abs, err := filepath.Abs(c.JsDebug); err == nil {
		c.JsDebug = abs
	}
	if c.Chrome != "" && strings.Contains(c.Chrome, "/") {
		if abs, err := filepath.Abs(c.Chrome); err == nil {
			c.Chrome = abs
		}
	}

	if c.OIDCIssuer != "" && c.OIDCClientID == "" {
		return nil, errors.New("GOLAND_OIDC_CLIENT_ID is required when GOLAND_OIDC_ISSUER is set")
	}
	if c.OIDCIssuer != "" {
		hasOpenID := false
		for _, scope := range c.OIDCScopes {
			if scope == "openid" {
				hasOpenID = true
				break
			}
		}
		if !hasOpenID {
			c.OIDCScopes = append([]string{"openid"}, c.OIDCScopes...)
		}
		if c.OIDCRedirectURL != "" {
			parsed, err := url.Parse(c.OIDCRedirectURL)
			if err != nil || !parsed.IsAbs() || parsed.Host == "" {
				return nil, errors.New("GOLAND_OIDC_REDIRECT_URL must be an absolute URL")
			}
		}
	}

	roots := env("GOLAND_WORKSPACE_ROOTS", filepath.Join(c.DataDir, "workspaces"))
	for _, root := range strings.Split(roots, string(os.PathListSeparator)) {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, fmt.Errorf("workspace root %q: %w", root, err)
		}
		if err := os.MkdirAll(abs, 0o755); err != nil {
			return nil, fmt.Errorf("create workspace root %q: %w", abs, err)
		}
		real, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("resolve workspace root %q: %w", abs, err)
		}
		c.WorkspaceRoots = append(c.WorkspaceRoots, real)
	}
	if len(c.WorkspaceRoots) == 0 {
		return nil, errors.New("GOLAND_WORKSPACE_ROOTS resolved to no directories")
	}
	switch c.Isolation {
	case "auto":
		if os.Geteuid() == 0 {
			c.Isolation = "user"
		} else {
			c.Isolation = "none"
		}
	case "user", "none":
	default:
		return nil, fmt.Errorf("GOLAND_ISOLATION must be auto, user or none")
	}
	if c.Isolation == "user" && os.Geteuid() != 0 {
		return nil, errors.New("GOLAND_ISOLATION=user requires the backend to run as root")
	}

	key, err := loadMasterKey(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.MasterKey = key
	return c, nil
}

func (c *Config) PrimaryWorkspaceRoot() string { return c.WorkspaceRoots[0] }

func loadMasterKey(dataDir string) ([]byte, error) {
	if raw := strings.TrimSpace(os.Getenv("GOLAND_MASTER_KEY")); raw != "" {
		key, err := base64.StdEncoding.DecodeString(raw)
		if err != nil || len(key) != 32 {
			return nil, errors.New("GOLAND_MASTER_KEY must be base64-encoded 32 bytes")
		}
		return key, nil
	}

	path := env("GOLAND_MASTER_KEY_FILE", filepath.Join(dataDir, "master.key"))
	if raw, err := os.ReadFile(path); err == nil {
		key, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if decErr != nil || len(key) != 32 {
			return nil, fmt.Errorf("invalid master key file %s", path)
		}
		return key, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(key)+"\n"), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func splitCSV(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, strings.TrimSuffix(part, "/"))
		}
	}
	return out
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
