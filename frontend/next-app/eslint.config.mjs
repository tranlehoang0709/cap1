import {defineConfig,globalIgnores} from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
export default defineConfig([...next,...ts,globalIgnores(['.next/**','.npm-cache/**','test-results/**','public/robot/**','next-env.d.ts'])]);
