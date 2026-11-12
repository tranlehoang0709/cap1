'use client';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {NovaInteractionController} from './NovaInteractionController';
const Context=createContext<NovaInteractionController|null>(null);
export function NovaInteractionProvider({children}:{children:ReactNode}){const [controller]=useState(()=>new NovaInteractionController());return <Context.Provider value={controller}>{children}</Context.Provider>;}
export function useNovaInteractions(){const value=useContext(Context);if(!value)throw new Error('NOVA interaction provider missing');return value;}
