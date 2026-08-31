import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.camai.mobile',
  appName: 'CamAI Mobile',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
