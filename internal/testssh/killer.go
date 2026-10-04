package testssh

import (
	"net"
	"sync"
	"sync/atomic"
)

// KillSwitch arms client-side connection kills: every new connection
// dialed through Wrap() is hard-closed once its threshold of
// transferred bytes is passed (simulating a connection drop mid
// transfer from the client side). One threshold per connection, in
// order; exhausted list = no more kills.
type KillSwitch struct {
	mu         sync.Mutex
	thresholds []int64
	idx        int
}

// NewKillSwitch arms thresholds, one per subsequent connection.
func NewKillSwitch(thresholds ...int64) *KillSwitch {
	return &KillSwitch{thresholds: thresholds}
}

// Wrap is the sshconn.WithConnWrap callback.
func (k *KillSwitch) Wrap() func(net.Conn) net.Conn {
	return func(c net.Conn) net.Conn {
		k.mu.Lock()
		var threshold int64
		if k.idx < len(k.thresholds) {
			threshold = k.thresholds[k.idx]
		}
		k.idx++
		k.mu.Unlock()
		return &killClientConn{Conn: c, threshold: threshold}
	}
}

type killClientConn struct {
	net.Conn
	threshold int64
	seen      atomic.Int64
	once      sync.Once
}

func (k *killClientConn) passed(n int) {
	if k.threshold <= 0 {
		return
	}
	if k.seen.Add(int64(n)) >= k.threshold {
		k.once.Do(func() {
			if tc, ok := k.Conn.(*net.TCPConn); ok {
				_ = tc.SetLinger(0)
			}
			_ = k.Conn.Close()
		})
	}
}

func (k *killClientConn) Read(b []byte) (int, error) {
	n, err := k.Conn.Read(b)
	k.passed(n)
	return n, err
}

func (k *killClientConn) Write(b []byte) (int, error) {
	n, err := k.Conn.Write(b)
	k.passed(n)
	return n, err
}
