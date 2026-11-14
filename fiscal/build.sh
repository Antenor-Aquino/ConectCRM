#!/bin/sh
# Gera o ConectCRMFiscal.exe (Windows 64 bits) a partir do Linux.
# Precisa de Go 1.24+ e do compilador mingw-w64 (apt-get install gcc-mingw-w64-x86-64).
set -e
cd "$(dirname "$0")"
go vet ./...
go test -count=1 ./...
CGO_ENABLED=1 GOOS=windows GOARCH=amd64 CC=x86_64-w64-mingw32-gcc \
  go build -trimpath -ldflags "-H windowsgui -s -w" -o "${1:-dist/ConectCRMFiscal.exe}" .
echo "ok: ${1:-dist/ConectCRMFiscal.exe}"
