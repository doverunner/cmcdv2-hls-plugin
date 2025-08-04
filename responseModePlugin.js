(() => {
    const _enableResponseMode = (hls, config) => {
        const currentMode = config.mode || 'json';
        const cmcdBatchArray = (currentMode === 'json') ? [] : null;
        const mediaElement = hls.media;

        let sequenceNumber = 0;
        let timePlay = null;
        let msd = null;
        let msdSent = false;
        let fragmentStartTimes = new Map();

        if (mediaElement) {
            mediaElement.addEventListener('play', function () {
                if (timePlay == null) timePlay = new Date().getTime();
            });

            mediaElement.addEventListener('playing', function () {
                if (msd == null) msd = new Date().getTime() - timePlay;
            });
        }

        function sendCmcdReport(cmcdData, reportingUrl) {
            if (currentMode == 'json') {
                if (!cmcdData || cmcdData.length === 0) return;
        
                fetch(reportingUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(cmcdData),
                })
                .then(reportResponse => {
                    // console.log(reportResponse.ok ? 'CMCD batch data reported successfully.' : `Reporting server responded with an error.`);
                })
                .catch(error => {
                    console.error('Error sending CMCD batch data to reporting server:', error);
                });
            } else if (currentMode === 'query') {
                if (!cmcdData) return;
                
                fetch(reportingUrl, {
                    method: 'GET',
                })
                .then(reportResponse => {
                    // console.log(reportResponse.ok ? 'CMCD query data reported successfully.' : `Reporting server responded with an error`);
                })
                .catch(error => {
                    console.error('Error sending CMCD query data to reporting server:', error);
                });
            }
        }

        function getPlayerState(hls) {
            if (!mediaElement) return;
            if (mediaElement.seeking) return 'k';
            if (hls.loadLevel === -1 && mediaElement.readyState < 3) return 'r';
            if (mediaElement.ended) return 'e';
            if (mediaElement.paused) {
                if (mediaElement.currentTime === 0 && mediaElement.played.length === 0) {
                    return 'p';
                }
                return 'a';
            }
            if (mediaElement.readyState < 3) {
                return 's';
            }
            return 'p';
        }

        function filterNullUndefined(obj) {
            const filtered = {};
            for (const key in obj) {
                if (obj[key] !== null && obj[key] !== undefined) {
                    filtered[key] = obj[key];
                }
            }
            return filtered;
        }

        function parseAndAddCmcdFromString(cmcdStr, targetObj) {
            if (!cmcdStr) return;
            const pairs = cmcdStr.split(',');
            pairs.forEach(pair => {
                const firstEq = pair.indexOf('=');
                let key, value;
                if (firstEq > 0) {
                    key = pair.substring(0, firstEq);
                    const valueStr = pair.substring(firstEq + 1);
                    if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
                        value = valueStr.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    } else {
                        const num = Number(valueStr);
                        value = (!isNaN(num) && String(num) === valueStr.trim()) ? num : valueStr;
                    }
                } else if (pair.trim()) {
                    key = pair.trim();
                    value = true;
                }
                if (key) {
                    targetObj[key] = value;
                }
            });
        }

        function processCmcdData(eventData, eventType) {
            try {
                const cmcdJsonObjectForBody = {};
                const newCmcdPairs = [];
                
                let requestUri;
                if (eventType === 'FRAG_LOADED' && eventData.frag) {
                    requestUri = new URL(eventData.frag.url);
                } else if (eventType === 'MANIFEST_LOADED' && eventData.url) {
                    requestUri = new URL(eventData.url);
                } else {
                    return;
                }

                parseAndAddCmcdFromString(requestUri.searchParams.get('CMCD') || '', cmcdJsonObjectForBody);
                
                let key, value;

                key = 'ts';
                if (!cmcdJsonObjectForBody[key]) {
                    const startTime = fragmentStartTimes.get(requestUri.toString());
                    if (startTime && (config.includeKeys === undefined || config.includeKeys.includes(key))) {
                        value = Math.round(startTime);
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'ttfb';
                if (!cmcdJsonObjectForBody[key]) {
                    if (eventData.stats && eventData.stats.tfirst && (config.includeKeys === undefined || config.includeKeys.includes(key))) {
                        value = Math.round(eventData.stats.tfirst - eventData.stats.trequest);
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'ttlb';
                if (!cmcdJsonObjectForBody[key]) {
                    if (eventData.stats && eventData.stats.tload && eventData.stats.trequest && (config.includeKeys === undefined || config.includeKeys.includes(key))) {
                        value = Math.round(eventData.stats.tload - eventData.stats.trequest);
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'rc';
                if (!cmcdJsonObjectForBody[key]) {
                    if (eventData.networkDetails && eventData.networkDetails.status && (config.includeKeys === undefined || config.includeKeys.includes(key))) {
                        value = eventData.networkDetails.status;
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'url';
                if (!cmcdJsonObjectForBody[key]) {
                    value = requestUri.toString().split('?')[0];
                    cmcdJsonObjectForBody[key] = value;
                    const escapedUrlValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    newCmcdPairs.push(`${key}="${escapedUrlValue}"`);
                }

                key = 'pt';
                if (!cmcdJsonObjectForBody[key] && mediaElement) {
                    if (hls.liveSyncPosition !== undefined) {
                        value = Date.now();
                    } else {
                        value = mediaElement.currentTime;
                    }
                    if (value > 0) {
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'ltc';
                if (!cmcdJsonObjectForBody[key]) {
                    if (hls.liveSyncPosition !== undefined && mediaElement) {
                        const liveLatency = hls.liveSyncPosition - mediaElement.currentTime;
                        if (liveLatency > 0) {
                            value = Math.round(liveLatency * 1000);
                            cmcdJsonObjectForBody[key] = value;
                            newCmcdPairs.push(`${key}=${value}`);
                        }
                    }
                }

                key = 'pr';
                if (!cmcdJsonObjectForBody[key] && mediaElement) {
                    value = mediaElement.playbackRate;
                    cmcdJsonObjectForBody[key] = value;
                    newCmcdPairs.push(`${key}=${value}`);
                }

                key = 'sta';
                if (!cmcdJsonObjectForBody[key]) {
                    value = getPlayerState(hls);
                    cmcdJsonObjectForBody[key] = value;
                    newCmcdPairs.push(`${key}=${value}`);
                }

                key = 'msd';
                if (cmcdJsonObjectForBody[key] && msdSent) {
                    delete cmcdJsonObjectForBody[key];
                }
                
                if (cmcdJsonObjectForBody[key]) {
                    msdSent = true;
                }

                if (!msdSent && msd) {
                    value = msd;
                    msdSent = true;
                    cmcdJsonObjectForBody[key] = value;
                    newCmcdPairs.push(`${key}=${value}`);
                }

                key = 'df';
                if (!cmcdJsonObjectForBody[key] && mediaElement) {
                    if (mediaElement.getVideoPlaybackQuality) {
                        value = mediaElement.getVideoPlaybackQuality().droppedVideoFrames;
                        cmcdJsonObjectForBody[key] = value;
                        newCmcdPairs.push(`${key}=${value}`);
                    }
                }

                key = 'sn';
                if (!cmcdJsonObjectForBody[key]) {
                    value = sequenceNumber;
                    cmcdJsonObjectForBody[key] = value;
                    newCmcdPairs.push(`${key}=${value}`);
                    sequenceNumber = sequenceNumber + 1;
                }

                const reportUrl = new URL(config.url);
                if (currentMode == 'json') {
                    const filteredCmcdData = filterNullUndefined(cmcdJsonObjectForBody);
                    cmcdBatchArray.push(filteredCmcdData);
                    
                    if (cmcdBatchArray.length >= config.batchSize) {
                        sendCmcdReport(cmcdBatchArray.slice(), reportUrl);
                        cmcdBatchArray.length = 0;
                    }
                } else if (currentMode == 'query') {
                    const filteredCmcdData = filterNullUndefined(cmcdJsonObjectForBody);
                    const filteredPairs = [];
                    for (const key in filteredCmcdData) {
                        const value = filteredCmcdData[key];
                        if (typeof value === 'string') {
                            const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            filteredPairs.push(`${key}="${escapedValue}"`);
                        } else {
                            filteredPairs.push(`${key}=${value}`);
                        }
                    }
                    const cmcdDataString = filteredPairs.join(',');
                    reportUrl.searchParams.set('CMCD', cmcdDataString);
                    sendCmcdReport(cmcdDataString, reportUrl);
                }

            } catch (e) {
                console.error('Error processing CMCD data for reporting:', e);
            }
        }

        hls.on('hlsFragLoading', (event, data) => {
            if (data.frag && data.frag.url) {
                fragmentStartTimes.set(data.frag.url, Date.now());
            }
        });

        hls.on('hlsFragLoaded', (event, data) => {
            processCmcdData(data, 'FRAG_LOADED');
        });

        hls.on('hlsManifestLoaded', (event, data) => {
            processCmcdData(data, 'MANIFEST_LOADED');
        });
    };

    window.hlsCmcdResponsePlugin = {
        enableResponseMode(hls, config) {
            _enableResponseMode(hls, config);
        }
    };
})();