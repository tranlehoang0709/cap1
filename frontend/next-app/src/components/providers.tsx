'use client';
import { ThemeProvider } from 'next-themes';
import { MotionConfig } from 'motion/react';
import {useEffect} from 'react';
import {useTheme} from 'next-themes';
import {AIVA_THEMES,DEFAULT_THEME,normalizeTheme} from '@/lib/theme-policy';
import {PageMotionPolicy} from './motion/PageMotionPolicy';
// Repair legacy/invalid cross-tab storage values, including when writing storage fails.
function ThemePolicy(){const {theme,setTheme}=useTheme();useEffect(()=>{if(theme!==undefined&&theme!==normalizeTheme(theme))setTheme(normalizeTheme(theme));},[theme,setTheme]);return null;}
export function Providers({ children }: {
    children: React.ReactNode;
}) { return <ThemeProvider attribute="class" defaultTheme={DEFAULT_THEME} themes={AIVA_THEMES} enableSystem={false} value={{light:'light',dark:'dark',system:'dark'}}><ThemePolicy/><PageMotionPolicy/><MotionConfig reducedMotion="user">{children}</MotionConfig></ThemeProvider>; }
