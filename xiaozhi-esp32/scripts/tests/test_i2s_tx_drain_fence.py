"""Compile/run EOF state logic; simulated interrupts are NOT hardware proof."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class TxDrainFenceTests(unittest.TestCase):
    def test_eof_write_failure_and_invalidation(self):
        source = r'''
#include "main/audio/i2s_tx_drain_fence.h"
#include "main/protocols/voice_playback_guard.h"
#include <cassert>
int main() {
    I2sTxDrainFence a, b;
    assert(!a.Drained());
    for (unsigned i=1;i<=6;++i) a.OnSent(i); // old/idle events don't count
    assert(!a.Drained());
    a.BeginWrite(); a.EndWrite(true);
    for (unsigned i=1;i<=6;++i) a.OnSent(i);
    assert(!a.Drained()); // successful write and first pass are insufficient
    for (unsigned i=0;i<100;++i) a.OnSent(1);
    assert(!a.Drained()); // duplicate EOF isn't a complete descriptor set
    for (unsigned i=2;i<=5;++i) a.OnSent(i);
    assert(!a.Drained()); a.OnSent(6); assert(a.Drained());
    assert(!b.Drained());
    a.BeginWrite(); assert(!a.Drained());
    a.EndWrite(false);
    for (unsigned i=0;i<100;++i) a.OnSent(i%6+1);
    assert(!a.Drained()); // partial/error write cannot establish a fence
    a.BeginWrite(); a.EndWrite(true);
    for (unsigned i=1;i<=6;++i) a.OnSent(i);
    a.OnSent(7); // different ring / wrong buffer
    for (unsigned i=0;i<100;++i) a.OnSent(i%6+1);
    assert(!a.Drained());
    a.BeginWrite(); a.EndWrite(true); a.OnSent(1);
    a.Invalidate();
    for (unsigned i=0;i<100;++i) a.OnSent(i%6+1);
    assert(!a.Drained()); // late interrupts after disable/cancel
    a.BeginWrite(); a.EndWrite(true);
    for (unsigned i=0;i<12;++i) a.OnSent(i%6+1);
    assert(a.Drained());
    VoicePlaybackGuard voice;
    assert(voice.Begin("turn","generation"));
    voice.Poll(true); auto id=voice.Receive(); voice.Played(id,true);
    voice.Stop("turn","generation",1);
    assert(voice.Poll(true,false).state==VoicePlaybackGuard::State::None);
    assert(voice.Poll(false,a.Drained()).state==VoicePlaybackGuard::State::None);
    assert(voice.Poll(true,a.Drained()).state==VoicePlaybackGuard::State::Complete);
    assert(voice.Poll(true,a.Drained()).state==VoicePlaybackGuard::State::None);
}
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path/'test.cc').write_text(source)
            subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror','-pthread','-I',str(ROOT),str(path/'test.cc'),'-o',str(path/'test')],check=True)
            subprocess.run([str(path/'test')],check=True,timeout=5)
