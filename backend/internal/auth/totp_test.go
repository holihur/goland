package auth

import (
	"strings"
	"testing"
	"time"
)

func TestTOTPAndRecoveryCodes(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil || secret == "" {
		t.Fatalf("secret: %q %v", secret, err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	code, err := TOTPCode(secret, now)
	if err != nil || len(code) != 6 {
		t.Fatalf("code: %q %v", code, err)
	}
	if !ValidateTOTP(secret, code, now) {
		t.Fatal("current code rejected")
	}
	if !ValidateTOTP(secret, code, now.Add(30*time.Second)) {
		t.Fatal("one-step skew rejected")
	}
	if ValidateTOTP(secret, "000000", now) && code != "000000" {
		t.Fatal("wrong code accepted")
	}
	uri := TOTPProvisioningURI("Goland", "user@example.com", secret)
	if !strings.HasPrefix(uri, "otpauth://totp/") || !strings.Contains(uri, "secret="+secret) || !strings.Contains(uri, "issuer=Goland") {
		t.Fatalf("uri: %s", uri)
	}
	codes, hashes, err := GenerateRecoveryCodes(3)
	if err != nil || len(codes) != 3 || len(hashes) != 3 {
		t.Fatalf("recovery: %#v %#v %v", codes, hashes, err)
	}
	remaining, ok := VerifyRecoveryCode(hashes, codes[1])
	if !ok || len(remaining) != 2 {
		t.Fatalf("verify recovery: %#v %v", remaining, ok)
	}
	if _, ok := VerifyRecoveryCode(remaining, codes[1]); ok {
		t.Fatal("recovery code reused")
	}
}
