'use client';
import {useEffect} from 'react';
export function PageMotionPolicy(){useEffect(()=>{const root=document.documentElement;const sync=()=>{root.dataset.pageVisible=String(!document.hidden);};sync();document.addEventListener('visibilitychange',sync);return()=>{document.removeEventListener('visibilitychange',sync);delete root.dataset.pageVisible;};},[]);return null;}
