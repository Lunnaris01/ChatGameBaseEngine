import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.chatstory',
  appName: 'Chat Story',
  webDir: 'dist',
  plugins: {
    // Android 15 draws the WebView under the system bars. Inject the inset
    // values so the phone shell can stay clear of the status and navigation bars.
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK'
    }
  }
};

export default config;
