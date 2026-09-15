declare module 'expo-image-picker' {
  export enum MediaTypeOptions {
    All = 'All',
    Images = 'images',
    Videos = 'Videos',
  }
  export interface ImagePickerOptions {
    mediaTypes?: any;
    allowsEditing?: boolean;
    aspect?: [number, number];
    quality?: number;
    base64?: boolean;
  }
  export interface ImagePickerAsset {
    uri: string;
    width?: number;
    height?: number;
    type?: string;
    base64?: string;
  }
  export interface ImagePickerResult {
    canceled: boolean;
    assets: ImagePickerAsset[];
  }
  export interface PermissionResponse {
    granted: boolean;
    status: string;
  }
  export function requestCameraPermissionsAsync(): Promise<PermissionResponse>;
  export function launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  export function launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
}

declare module 'expo-location' {
  export enum Accuracy {
    Lowest = 1,
    Low = 2,
    Balanced = 3,
    High = 4,
    Highest = 5,
    BestForNavigation = 6,
  }
  export interface LocationObject {
    coords: {
      latitude: number;
      longitude: number;
      altitude: number | null;
      accuracy: number | null;
      altitudeAccuracy: number | null;
      heading: number | null;
      speed: number | null;
    };
    timestamp: number;
  }
  export interface PermissionResponse {
    granted: boolean;
    status: string;
  }
  export function requestForegroundPermissionsAsync(): Promise<PermissionResponse>;
  export function getCurrentPositionAsync(options?: { accuracy?: Accuracy }): Promise<LocationObject>;
}

declare module 'expo-background-fetch' {
  export enum BackgroundFetchResult {
    NoData = 1,
    NewData = 2,
    Failed = 3,
  }
  export function registerTaskAsync(taskName: string, options?: object): Promise<void>;
  export function unregisterTaskAsync(taskName: string): Promise<void>;
}

declare module 'expo-task-manager' {
  export function defineTask(taskName: string, taskExecutor: (body?: any) => any): void;
  export function isTaskDefined(taskName: string): boolean;
  export function isTaskRegisteredAsync(taskName: string): Promise<boolean>;
}
