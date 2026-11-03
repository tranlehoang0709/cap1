"""Compile/run negotiated voice drain logic without pretending to build ESP-IDF."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]

class VoicePlaybackTests(unittest.TestCase):
    def test_drain_count_generation_and_failure(self):
        source=r'''
#include "main/protocols/voice_playback_guard.h"
#include <cassert>
int main() {
    using S=VoicePlaybackGuard::State;
    VoicePlaybackGuard g;
    assert(!g.Begin("", "x"));
    assert(g.Begin("turn1", "generation1"));
    assert(!g.Begin("turn2", "generation2"));
    assert(!g.Receive());
    assert(g.Poll(false).state==S::None);
    assert(g.Poll(true).state==S::Ready);
    auto first=g.Receive(); assert(first>=0x80000000);
    auto second=g.Receive(); assert(second==first);
    assert(!g.Stop("wrong", "generation1", 2));
    assert(g.Stop("turn1", "generation1", 2));
    assert(!g.Receive());
    assert(g.Poll(false).state==S::None);
    g.Played(first,true); g.Played(second,true);
    assert(g.Poll(false).state==S::None);
    // Queue drain + write completion alone MUST NOT acknowledge physical output.
    assert(g.Poll(true).state==S::None);
    auto done=g.Poll(true,true); assert(done.state==S::Complete && done.chunks==2);
    assert(g.Poll(true).state==S::None);
    assert(!g.Stop("turn1","generation1",2));
    assert(g.Begin("turn2","generation2"));
    g.Poll(true); auto next=g.Receive(); assert(next!=first);
    g.Played(first,true); // late callback from previous turn cannot count
    assert(g.Stop("turn2","generation2",1));
    assert(g.Poll(true).state==S::Failed);
    assert(g.Begin("turn3","generation3")); g.Poll(true);
    auto bad=g.Receive(); g.Played(bad,false);
    assert(g.Poll(false).state==S::Failed);
    assert(g.Begin("turn4","generation4")); g.Poll(true); g.Receive();
    assert(g.Stop("turn4","generation4",2));
    assert(g.Poll(false).state==S::Failed);
    assert(g.Begin("turn5","generation5")); g.Cancel();
    assert(!g.Receive() && g.Poll(true).state==S::None);
    VoicePlaybackGuard other;
    assert(other.Begin("other", "other")); assert(other.Poll(true).state==S::Ready);
}
'''
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)
            (path/'test.cc').write_text(source)
            subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror','-pthread','-I',str(ROOT),str(path/'test.cc'),'-o',str(path/'test')],check=True)
            subprocess.run([str(path/'test')],check=True,timeout=5)
