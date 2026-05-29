export enum ActivePane {
  GetStarted,
  DeviceCheck,
  DeviceError,
  CameraTest,
  AudioTest,
  BrowserTest,
  Connectivity,
  Quality,
  Results,
}

export type TwilioAPIStatus = 'operational' | 'major_outage' | 'partial_outage' | 'degraded_performance';

export interface TwilioStatus {
  ['Group Rooms']?: TwilioAPIStatus;
  ['Go Rooms']?: TwilioAPIStatus;
  ['Peer-to-Peer Rooms']?: TwilioAPIStatus;
  ['Recordings']?: TwilioAPIStatus;
  ['Compositions']?: TwilioAPIStatus;
  ['Network Traversal Service']?: TwilioAPIStatus;
}
