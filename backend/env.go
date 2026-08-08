package main

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

func init() {
	godotenv.Load()
}

// String retrieves the value of the environment variable named env. If it
// is unset, or set to an empty string, the fallback value fb is returned
// instead. It does not modify the environment.
func String(env, fb string) string {
	if v := os.Getenv(env); v != "" {
		return v
	}
	return fb
}

// StringSlice retrieves the value of the environment variable named env and
// splits it on commas, trimming whitespace from each entry and dropping any
// that are empty. If the variable is unset, empty, or has no non-empty
// entries after splitting, the fallback slice fb is returned instead. It
// does not modify the environment.
func StringSlice(env string, fb []string) []string {
	v := os.Getenv(env)
	if v == "" {
		return fb
	}

	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return fb
	}
	return out
}
