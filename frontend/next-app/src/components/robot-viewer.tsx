'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Sparkles, Hand, Brain, Smile } from 'lucide-react';
import { Button } from './ui/button';
import {
  NovaInteractionProvider,
  useNovaInteractions,
} from './robot/NovaInteractionProvider';

const InteractiveNovaCanvas = dynamic(() => import('./robot/NovaCanvas'), {
  ssr: false,
  loading: () => (
    <div className="nova-3d-loading" role="status">
      Đang khởi tạo mô hình NOVA 3D…
    </div>
  ),
});

function NovaCompanionStage() {
  const nova = useNovaInteractions();
  const [pose, setPose] = useState<'idle' | 'wave' | 'thinking' | 'success'>('idle');

  function triggerPose(next: 'idle' | 'wave' | 'thinking' | 'success') {
    setPose(next);
    nova.send({ type: 'preview', mode: next === 'wave' ? 'greeting' : next });
  }

  return (
    <div className="nova-companion-stage">
      <div className="nova-companion-canvas">
        <InteractiveNovaCanvas enableBeastMode={false} compact />
      </div>
      <div className="nova-pose-toolbar" role="group" aria-label="Biểu cảm NOVA">
        <button
          type="button"
          className={pose === 'idle' ? 'active' : ''}
          onClick={() => triggerPose('idle')}
        >
          <Sparkles size={13} />
          <span>Bình thường</span>
        </button>
        <button
          type="button"
          className={pose === 'wave' ? 'active' : ''}
          onClick={() => triggerPose('wave')}
        >
          <Hand size={13} />
          <span>Chào hỏi</span>
        </button>
        <button
          type="button"
          className={pose === 'thinking' ? 'active' : ''}
          onClick={() => triggerPose('thinking')}
        >
          <Brain size={13} />
          <span>Suy nghĩ</span>
        </button>
        <button
          type="button"
          className={pose === 'success' ? 'active' : ''}
          onClick={() => triggerPose('success')}
        >
          <Smile size={13} />
          <span>Hào hứng</span>
        </button>
      </div>
    </div>
  );
}

export function RobotViewer() {
  const [show, setShow] = useState(false);
  return (
    <div className="robot-viewer">
      {show ? (
        <NovaInteractionProvider>
          <NovaCompanionStage />
        </NovaInteractionProvider>
      ) : (
        <div className="robot-poster">
          <div className="nova-emblem" aria-hidden="true">
            <span className="nova-emblem-halo" />
            <div className="nova-head">
              <span className="nova-antenna" />
              <span className="nova-ear left" />
              <span className="nova-ear right" />
              <div className="nova-visor">
                <i className="nova-eye" />
                <i className="nova-eye" />
                <span className="nova-smile" />
              </div>
            </div>
            <div className="nova-torso">
              <span className="nova-core" />
            </div>
          </div>
          <div className="nova-poster-meta">
            <span className="nova-badge">NOVA · AI COMPANION</span>
          </div>
          <Button variant="outline" onClick={() => setShow(true)}>
            <Box size={16} />
            Khám phá NOVA 3D
          </Button>
        </div>
      )}
      <p className="fine">
        Mô hình NOVA minh họa · Trạng thái kết nối thiết bị lấy trực tiếp từ Backend
      </p>
      {show && (
        <Button variant="ghost" onClick={() => setShow(false)}>
          Đóng mô hình 3D / tiết kiệm tài nguyên
        </Button>
      )}
    </div>
  );
}
