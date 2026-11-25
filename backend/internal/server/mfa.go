package server

import (
	"net/http"
	"strings"
	"time"

	"goland/internal/auth"
	"goland/internal/cryptoutil"
)

func (s *Server) mfaBox() (*cryptoutil.Box, error) {
	return cryptoutil.New(s.cfg.MasterKey)
}

func (s *Server) decryptMFASecret(secret string) (string, error) {
	box, err := s.mfaBox()
	if err != nil {
		return "", err
	}
	return box.Decrypt(secret)
}

func (s *Server) mfaStatus(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": user.MFAEnabled, "enrolledAt": user.MFAEnrolledAt,
		"required": s.cfg.MFARequired, "recoveryCodes": len(user.MFARecoveryCodes),
	})
}

func (s *Server) setupMFA(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	user := currentUser(r)
	if user.MFAEnabled {
		writeError(w, http.StatusConflict, "mfa_enabled", "multi-factor authentication is already enabled")
		return
	}
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not generate MFA secret")
		return
	}
	box, err := s.mfaBox()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "encryption is unavailable")
		return
	}
	encrypted, err := box.Encrypt(secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not protect MFA secret")
		return
	}
	if err := s.store.UpdateUserMFA(r.Context(), user.ID, false, encrypted, nil, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save MFA setup")
		return
	}
	s.audit(r, "auth.mfa.setup", user.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{
		"secret": secret, "otpauthUrl": auth.TOTPProvisioningURI("Goland", user.Email, secret),
	})
}

func (s *Server) enableMFA(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	user := currentUser(r)
	if user.MFAEnabled {
		writeError(w, http.StatusConflict, "mfa_enabled", "multi-factor authentication is already enabled")
		return
	}
	if user.MFASecret == "" {
		writeError(w, http.StatusBadRequest, "mfa_setup_required", "start MFA setup first")
		return
	}
	secret, err := s.decryptMFASecret(user.MFASecret)
	if err != nil || !auth.ValidateTOTP(secret, body.Code, time.Now().UTC()) {
		writeError(w, http.StatusBadRequest, "invalid_code", "invalid authenticator code")
		return
	}
	codes, hashes, err := auth.GenerateRecoveryCodes(10)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not generate recovery codes")
		return
	}
	now := time.Now().UTC()
	if err := s.store.UpdateUserMFA(r.Context(), user.ID, true, user.MFASecret, hashes, &now); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not enable MFA")
		return
	}
	if sess := auth.SessionFrom(r.Context()); sess != nil {
		_ = s.store.UpdateSessionMFA(r.Context(), sess.ID, true, now.Add(s.auth.TTL))
	}
	s.audit(r, "auth.mfa.enable", user.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "recoveryCodes": codes})
}

func (s *Server) disableMFA(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	if s.cfg.MFARequired {
		writeError(w, http.StatusForbidden, "mfa_enforced", "MFA is enforced by the server policy")
		return
	}
	var body struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	user := currentUser(r)
	if !user.MFAEnabled {
		writeError(w, http.StatusConflict, "mfa_disabled", "multi-factor authentication is not enabled")
		return
	}
	if !auth.VerifyPassword(user.PasswordHash, body.Password) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid password")
		return
	}
	secret, err := s.decryptMFASecret(user.MFASecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read MFA secret")
		return
	}
	if !auth.ValidateTOTP(secret, body.Code, time.Now().UTC()) {
		remaining, ok := auth.VerifyRecoveryCode(user.MFARecoveryCodes, body.Code)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_code", "invalid authenticator or recovery code")
			return
		}
		_ = remaining
	}
	if err := s.store.UpdateUserMFA(r.Context(), user.ID, false, "", nil, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not disable MFA")
		return
	}
	s.audit(r, "auth.mfa.disable", user.ID.Hex(), "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) verifyMFA(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChallengeToken string `json:"challengeToken"`
		Code           string `json:"code"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	challenge := strings.TrimSpace(body.ChallengeToken)
	if challenge == "" || strings.TrimSpace(body.Code) == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "challengeToken and code are required")
		return
	}
	key := "mfa|" + r.RemoteAddr + "|" + challenge[:minInt(len(challenge), 24)]
	if blocked, wait := s.limiter.blocked(key); blocked {
		w.Header().Set("Retry-After", strings.TrimSpace(wait.Round(time.Second).String()))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many verification attempts")
		return
	}
	sess, err := s.store.FindSessionByHash(r.Context(), auth.TokenHash(challenge))
	if err != nil || sess.MFAVerified {
		s.limiter.fail(key)
		writeError(w, http.StatusUnauthorized, "invalid_challenge", "MFA challenge is invalid or expired")
		return
	}
	user, err := s.store.FindUserByID(r.Context(), sess.UserID)
	if err != nil || !user.MFAEnabled {
		s.limiter.fail(key)
		writeError(w, http.StatusUnauthorized, "invalid_challenge", "MFA challenge is invalid")
		return
	}
	secret, err := s.decryptMFASecret(user.MFASecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read MFA secret")
		return
	}
	now := time.Now().UTC()
	valid := auth.ValidateTOTP(secret, body.Code, now)
	recovery := false
	if !valid {
		remaining, ok := auth.VerifyRecoveryCode(user.MFARecoveryCodes, body.Code)
		if ok {
			valid = true
			recovery = true
			_ = s.store.UpdateUserMFA(r.Context(), user.ID, true, user.MFASecret, remaining, user.MFAEnrolledAt)
		}
	}
	if !valid {
		s.limiter.fail(key)
		writeError(w, http.StatusUnauthorized, "invalid_code", "invalid authenticator or recovery code")
		return
	}
	s.limiter.success(key)
	if err := s.store.UpdateSessionMFA(r.Context(), sess.ID, true, now.Add(s.auth.TTL)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not complete MFA")
		return
	}
	csrf, err := auth.RandomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create session")
		return
	}
	s.auth.SetCookies(w, challenge, csrf)
	action := "auth.mfa.verify"
	if recovery {
		action = "auth.mfa.recovery"
	}
	s.audit(r, action, user.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "csrfToken": csrf})
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
