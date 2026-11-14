module conectcrm/fiscal

go 1.26.0

require (
	github.com/beevik/etree v1.8.1
	github.com/github/smimesign v0.2.0
	github.com/russellhaering/goxmldsig v1.6.1
	golang.org/x/sys v0.50.0
)

require (
	github.com/jonboulle/clockwork v0.5.0 // indirect
	github.com/pkg/errors v0.8.1 // indirect
)

replace github.com/github/smimesign => ./third_party/smimesign
