package main

import (
	"github.com/joho/godotenv"
	"os"
)

func init() {
	godotenv.Load()
}

// String retrieves a string from the environment. If not found, writes the
// fallback value to the environment, before returning it.
func String(env, fb string) (r string) {
	r = fb
	if v, exists := os.LookupEnv(env); exists {
		r = v
	}

	return
}
