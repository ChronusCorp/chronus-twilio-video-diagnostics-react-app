# Twilio Video Diagnostics App

## What is it

This application demonstrates a diagnostics tool for testing a participant's ability to have a quality video call with the Twilio platform. It can be used as part of onboarding to ensure a successful first video call or for diagnosing issues that relate to the device, software, or network conditions of the end-user. It is built with [Twilio's Programmable Video JS SDK](https://github.com/twilio/rtc-diagnostics) and [Twilio's RTC Diagnostics SDK](https://github.com/twilio/rtc-diagnostics).

![](https://user-images.githubusercontent.com/11685703/131178895-a8995c2f-1fbd-451a-8949-2bfa4040b4f2.gif)

<p align="center">
    <i>A Twilio hosted version of this app can be found at <a href="https://video-diagnostics.twilio.com">https://video-diagnostics.twilio.com</a>.</i>
</p>



## What it tests

1. Access and permissions to the camera and microphone
2. Local audio and video via interactive camera, microphone, and speaker tests
3. Operating system and browser support
4. Connectivity to the Twilio cloud
5. Network performance and expected call quality

## Features

- Stepwise tests for device and software setup, connectivity with Twilio, and network performance
- Actionable user recommendations when tests fail
- Approachable UX for non-technical users with access to network statistics for those who need it
- Downloadable JSON report of the exhaustive test results
- Customizable and ready for self hosting or embedding into other web applications

## Prerequisites

- A Twilio account. Sign up for free [here](https://www.twilio.com/try-twilio).
- Node.js v22+ (matches the AWS Lambda runtime)
- NPM v10+ (comes installed with Node 22)

## Install Dependencies

Run `npm install` to install all the dependencies from NPM.

## Deploy the App

The app is deployed to AWS as a CloudFront distribution fronting an S3 bucket (static React build) and an API Gateway + Lambda (token + TURN credentials). See [DEPLOYMENT.md](DEPLOYMENT.md) for the full architecture, configuration, and step-by-step deploy commands.

Before deploying, store your Twilio Account SID, API Key SID, and API Key Secret as Lambda environment variables (see [DEPLOYMENT.md](DEPLOYMENT.md#lambda-environment-variables)).

When hosting this application, we recommend you serve it from the same domain as your video service. This ensures the end-user's device access and permissions for the diagnostics tests align with those of your video application.

## Local Development

### Running a local token server

This application requires an access token to run the [Preflight](src/components/AppStateProvider/usePreflightTest/usePreflightTest.ts) and [Bitrate](src/components/AppStateProvider/useBitrateTest/useBitrateTest.ts) tests. The included local token [server](server/index.ts) provides the application with access tokens and TURN credentials. This token server can be used to run the app locally, and it is the server that is used when this app is run in development mode with `npm start`. Perform the following steps to setup the local token server:

- If you haven't done so already, create an account in the [Twilio Console](https://www.twilio.com/console) and take note of your Account SID.
- Create a new API Key in the [API Keys Section](https://www.twilio.com/console/video/project/api-keys) under Programmable Video Tools in the Twilio Console. Take note of the SID and Secret of the new API key.
- Store your Account SID, API Key SID, and API Key Secret, in a new file called `.env` (see [.env.example](.env.example) for an example).

Now the local token server (see [server/index.ts](server/index.ts)) can dispense Access Tokens and TURN credentials to run the Preflight and Bitrate tests.

### Running the App locally

Run the app locally with

    npm start

This will start the local token server and run the app in the development mode. Open [http://localhost:3000](http://localhost:3000) to see the application in the browser.

The page will reload if you make changes to the source code in `src/`.
You will also see any linting errors in the console. If you need to run only the server on its own, you can start the token server locally with

    npm run server

The token server runs on port 8083.

The server provided with this application exposes the same `/app/token` and `/app/turn-credentials` endpoints as the [Lambda handler](lambda/handler.js) used in production, so the React app calls identical relative URLs in both environments.

## Building

Build the app by running:

    npm run build

This will build the static assets for the application in the `build/` directory.

## Tests

Run `npm test` to run all unit tests.

## License

See [LICENSE](LICENSE.md).
