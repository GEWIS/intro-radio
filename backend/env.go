package main

import (
	"github.com/joho/godotenv"
	"os"
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
