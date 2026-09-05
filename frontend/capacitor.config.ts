import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rhosam.supermarket',
  appName: 'RHoSAM POS',
  webDir: 'dist',
  server: {
    // In production, point to your deployed URL
    // url: 'https://rhosam-frontend.onrender.com',
    // cleartext: false,
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      backgroundColor: '#172033',
      style: 'DARK',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#172033',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      spinnerColor: '#16a34a',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK',
    },
  },
  ios: {
    scheme: 'RHoSAM POS',
  },
};

export default config;
