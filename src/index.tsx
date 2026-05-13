/**
 * Copyright (C) 2021 Twilio, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ReactDOM from 'react-dom';
import App from './App';
import theme from './theme';
import { CssBaseline, MuiThemeProvider } from '@material-ui/core';
import { parseToken } from './telemetry/parseToken';

function logOnPageLoad() {
  console.log('[page-load] NODE_ENV:', process.env.NODE_ENV);
  const hasToken = new URLSearchParams(window.location.search).has('t');
  if (!hasToken) return;
  const mode = parseToken(window.location.search);
  if (mode.mode === 'post') {
    console.log('[page-load] token is valid');
  } else {
    console.warn(`[page-load] token present but invalid (reason: ${mode.reason}) — telemetry disabled`);
  }
}

logOnPageLoad();

ReactDOM.render(
  <MuiThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </MuiThemeProvider>,
  document.getElementById('root')
);
