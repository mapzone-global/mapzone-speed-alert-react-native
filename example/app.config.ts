import type { ExpoConfig } from 'expo/config';

// Credentials come from example/.env (see .env.example). Expo CLI loads .env
// into process.env before evaluating this file.
const env = (key: string, fallback = '') => process.env[key] ?? fallback;

const config: ExpoConfig = {
  name: 'MapZone SpeedAlert Example',
  slug: 'mapzone-speed-alert-example',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    // Must be the application id registered with the alert service; the SDK
    // sends the running app's id as the auth bundleId.
    bundleIdentifier: 'vietmap.prod.test',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Used to feed GPS fixes to the speed alert engine.',
    },
  },
  android: {
    package: 'vietmap.prod.test',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    predictiveBackGestureEnabled: false,
  },
  plugins: ['expo-dev-client', 'expo-location'],
  extra: {
    baseUrl: env('SPEED_ALERT_BASE_URL'),
    apiKeyId: env('SPEED_ALERT_API_KEY_ID'),
    apiKey: env('SPEED_ALERT_API_KEY'),
    vehicleId: env('SPEED_ALERT_VEHICLE_ID', '10'),
    vehicleType: Number(env('SPEED_ALERT_VEHICLE_TYPE', '1')),
    seats: Number(env('SPEED_ALERT_SEATS', '5')),
    weights: Number(env('SPEED_ALERT_WEIGHTS', '1500')),
  },
};

export default config;
