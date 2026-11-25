package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	totpPeriod = 30
	totpDigits = 6
	totpSkew   = 1
)

func GenerateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func TOTPCode(secret string, at time.Time) (string, error) {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normalized)
	if err != nil {
		return "", fmt.Errorf("invalid TOTP secret: %w", err)
	}
	counter := uint64(at.Unix() / totpPeriod)
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 | uint32(sum[offset+1])<<16 | uint32(sum[offset+2])<<8 | uint32(sum[offset+3])
	return fmt.Sprintf("%0*d", totpDigits, value%1_000_000), nil
}

func ValidateTOTP(secret, code string, at time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	for offset := -totpSkew; offset <= totpSkew; offset++ {
		expected, err := TOTPCode(secret, at.Add(time.Duration(offset*totpPeriod)*time.Second))
		if err == nil && hmac.Equal([]byte(expected), []byte(code)) {
			return true
		}
	}
	return false
}

func TOTPProvisioningURI(issuer, account, secret string) string {
	label := url.PathEscape(account)
	values := url.Values{}
	values.Set("secret", secret)
	values.Set("issuer", issuer)
	values.Set("algorithm", "SHA1")
	values.Set("digits", strconv.Itoa(totpDigits))
	values.Set("period", strconv.Itoa(totpPeriod))
	return "otpauth://totp/" + label + "?" + values.Encode()
}

func GenerateRecoveryCodes(count int) (codes []string, hashes []string, err error) {
	if count <= 0 {
		count = 10
	}
	for i := 0; i < count; i++ {
		raw := make([]byte, 6)
		if _, err := rand.Read(raw); err != nil {
			return nil, nil, err
		}
		code := strings.ToUpper(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw))
		if len(code) > 10 {
			code = code[:10]
		}
		codes = append(codes, code)
		hashes = append(hashes, TokenHash(code))
	}
	return codes, hashes, nil
}

func VerifyRecoveryCode(hashes []string, code string) (remaining []string, ok bool) {
	hash := TokenHash(strings.TrimSpace(strings.ToUpper(code)))
	for _, item := range hashes {
		if hmac.Equal([]byte(item), []byte(hash)) {
			ok = true
			continue
		}
		remaining = append(remaining, item)
	}
	return remaining, ok
}
