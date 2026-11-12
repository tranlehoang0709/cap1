'use client';
import type {ComponentProps} from 'react';
import {motion} from 'motion/react';
import {Button} from '@/components/ui/button';
import {authPress,useAuthMotion} from './AuthMotion';
import './threeui-gradient.css';
/** Adapted from ThreeUI Community Gradient CTA (MIT). See THIRD_PARTY_THREEUI.md. */
const MotionButton=motion.create(Button);
export function AuthGlowButton(props:ComponentProps<typeof MotionButton>){const enabled=useAuthMotion();return <MotionButton {...props} initial={false} whileTap={{scale:enabled&&!props.disabled ? .97 : 1}} transition={enabled?authPress:{duration:0}} className={'auth-glow-button '+(props.className||'')}/>;}
