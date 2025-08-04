# CMCD v2 Plugin for HLS.js (CMCDv2 POC)

## Overview

The `responseModePlugin` is a JavaScript module designed to work with HLS.js. Its primary purpose is to enable CMCD Version 2 'Response Mode' to collect data related to server responses for media segment requests and report these metrics to a third-party server. Currently, the plugin supports two modes: JSON Mode and Query Mode.

This plugin can be used alongside HLS.js's native CMCD (Common Media Client Data) features when available.

## Samples

This repo has two samples to try the plugin, `sample-hls-latest.html` and `sample-hls-1-5-0.html`. One showcases how this plugin works with the latest version of HLS.js, and the other with HLS.js v1.5.0.

## Setup and Integration

Follow these steps to integrate the `responseModePlugin` into your HLS.js application:

1. **Include Scripts**:
   Make sure both HLS.js and the `responseModePlugin.js` are included in your HTML file before your application logic:
   ```html
   <script src="path/to/hls.min.js"></script>
   <script src="path/to/responseModePlugin.js"></script>
   ```

   Also, you can use jsDelivr to get these sources:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
   <script src="https://cdn.jsdelivr.net/gh/qualabs/hls.js-cmcd-v2-plugin/responseModePlugin.js"></script>
   ```

2. **Initialize HLS.js**:
   Set up your HLS.js instance as usual.
   ```javascript
   // Check for HLS.js support
   if (Hls.isSupported()) {
       initPlayer();
   } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
       // Native HLS support (Safari)
       video.src = manifestUri;
   } else {
       console.error('HLS is not supported!');
   }

   function initPlayer() {
       const video = document.getElementById('video');
       const hls = new Hls();
       
       // ... (responseModePlugin configuration - see below)

       hls.attachMedia(video);
       hls.loadSource(manifestUri);
   }
   ```

3. **(Optional) Configure HLS.js CMCD**:
   The plugin can gather CMCD data generated from Request Mode and includes it on the Response Mode report. If HLS.js CMCD is not enabled, only keys in `includeKeys` will be included on the Response Mode report.
   ```javascript
   const hls = new Hls({
       // HLS.js CMCD configuration (if available in your version)
       // cmcd: {
       //     version: 2,
       //     enabled: true,
       //     contentId: 'your-content-id',
       //     sessionId: 'your-unique-session-id'
       // }
   });
   ```

4. **Configure the `responseModePlugin`**:
   Create a configuration object for the plugin.
   ```javascript
   const reportingUrlString = 'https://collector-gcloud-function-560723680185.us-east1.run.app/cmcd/response-mode';
   
   const responseModePluginConfig = {
       mode: 'json', // Specify 'json' or 'query'
       batchSize: 8, // Batch is only available with json mode
       url: reportingUrlString, // The URL for the reporting endpoint
       // includeKeys: ['ts', 'ttfb', 'ttlb', 'url', 'pt', 'rc', 'ltc'] // Will send all keys if not configured
   };
   ```

5. **Enable the Plugin**:
   After the HLS.js instance is created and configured, enable the `responseModePlugin`.
   ```javascript
   // In your initPlayer function, after hls creation and configuration:
   hlsCmcdResponsePlugin.enableResponseMode(hls, responseModePluginConfig);
   ```

## Configuration Options

- **mode**: `'json'` or `'query'` - Determines how data is sent to the reporting server
- **batchSize**: Number (only for JSON mode) - Number of reports to batch before sending
- **url**: String - The reporting endpoint URL
- **includeKeys**: Array (optional) - Specific CMCD keys to include. Available keys: `['ts', 'ttfb', 'ttlb', 'url', 'pt', 'rc', 'ltc', 'pr', 'sta', 'msd', 'df', 'sn']`

## CMCD Keys Supported

- **ts**: Timestamp when request was initiated (epoch ms)
- **ttfb**: Time To First Byte (ms)
- **ttlb**: Time To Last Byte (ms)
- **rc**: Response code of the HTTP request
- **url**: URL of the requested resource (without query parameters)
- **pt**: Playhead time in seconds (VOD) or timestamp (Live)
- **ltc**: Live latency in milliseconds (Live streams only)
- **pr**: Playback rate
- **sta**: Player state (p=playing, a=paused, r=rebuffering, s=starting, k=seeking, e=ended)
- **msd**: Media Start Delay (sent once per session)
- **df**: Dropped video frames count
- **sn**: Sequence number for the report

## Differences from Shaka Player Plugin

- Uses HLS.js event system (`hlsFragLoaded`, `hlsManifestLoaded`) instead of response filters
- Adapts timing calculations to HLS.js's event data structure
- Handles HLS.js-specific player state detection
- Works with HLS.js's fragment loading architecture

## Browser Compatibility

This plugin works with any browser that supports HLS.js. For Safari and other browsers with native HLS support, additional integration may be needed.

## License

This project is licensed under the same terms as the original Shaka Player CMCD v2 plugin.
