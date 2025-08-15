(() => {
    const _enableCmcdV2 = (hls, config) => {
        const currentTransmissionMode = config.transmissionMode || 'json';
        const cmcdBatchArray = (currentTransmissionMode === 'json') ? [] : null;
        
        function getMediaElement() {
            return hls.media;
        }

        let sequenceNumber = 0;
        let timePlay = null;
        let msd = null;
        let msdSent = false;
        let fragmentStartTimes = new Map();

        function setupMediaElementListeners() {
            const mediaElement = getMediaElement();
            if (mediaElement) {
                mediaElement.addEventListener('play', function () {
                    if (timePlay == null) timePlay = new Date().getTime();
                });

                mediaElement.addEventListener('playing', function () {
                    if (msd == null) msd = new Date().getTime() - timePlay;
                });
            }
        }
        
        // Setup listeners when media is attached or immediately if already available
        if (getMediaElement()) {
            setupMediaElementListeners();
        } else {
            hls.on('hlsMediaAttached', setupMediaElementListeners);
        }

        function sendCmcdReport(cmcdData, reportingUrl) {
            if (currentTransmissionMode == 'json') {
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
            } else if (currentTransmissionMode === 'query') {
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
            const mediaElement = getMediaElement();
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

        function addResponseModeData(context) {
            const { eventData, cmcdData, requestUri } = context;

            // ttfb
            let stats = eventData.frag.stats ? { ...eventData.frag.stats } : null;
            if (shouldIncludeKey('ttfb') && stats && stats.loading?.first && stats.loading?.start) {
                cmcdData.ttfb = Math.round(stats.loading.first - stats.loading.start);
            }

            // ttlb
            if (shouldIncludeKey('ttlb') && stats && stats.loading.end && stats.loading.start) {
                cmcdData.ttlb = Math.round(stats.loading.end - stats.loading.start);
            }

            // rc
            if (shouldIncludeKey('rc') && eventData.networkDetails && eventData.networkDetails.status) {
                cmcdData.rc = eventData.networkDetails.status;
            }

            // url
            if (shouldIncludeKey('url') && requestUri) {
                cmcdData.url = requestUri.toString().split('?')[0];
            }

            // ts
            if (shouldIncludeKey('ts') && requestUri) {
                const uriString = requestUri.toString();
                const startTime = fragmentStartTimes.get(uriString);
                if (startTime) {
                    cmcdData.ts = Math.round(startTime);
                    fragmentStartTimes.delete(uriString);
                }
            }
        }

        function addEventModeData(context) {
            const { event, cmcdData } = context;
            
            // ts
            if (shouldIncludeKey('ts')) {
                cmcdData.ts = Date.now();
            }

            // e
            if (shouldIncludeKey('e')) {
                cmcdData.e = event;
            }
        }

        function shouldIncludeKey(key) {
            return config.includeKeys === undefined || config.includeKeys.includes(key);
        }

        function processCmcdData(eventData, eventType) {
            try {
                const cmcdData = {};
                
                let requestUri = null;
                if (eventType === 'FRAG_LOADED' && eventData.frag) {
                    requestUri = new URL(eventData.frag.url);
                } else if (eventType === 'MANIFEST_LOADED' && eventData.url) {
                    requestUri = new URL(eventData.url);
                }

                if (requestUri) {
                    parseAndAddCmcdFromString(requestUri.searchParams.get('CMCD') || '', cmcdData);
                }

                // pt
                const mediaElement = getMediaElement();
                if (shouldIncludeKey('pt') && mediaElement) {
                    let value;
                    if (hls.latestLevelDetails?.live || hls.levels[hls.currentLevel]?.details?.live) {
                        value = hls.playingDate;
                    } else {
                        value = mediaElement.currentTime;
                    }
                    if (value > 0) {
                        cmcdData.pt = value;
                    }
                }

                // ltc
                if (shouldIncludeKey('ltc') && hls.liveSyncPosition !== undefined && mediaElement) {
                    const liveLatency = hls.latency;
                    if (liveLatency > 0) {
                        cmcdData.ltc = liveLatency;
                    }
                }

                // pr
                if (shouldIncludeKey('pr') && mediaElement) {
                    cmcdData.pr = mediaElement.playbackRate;
                }

                // sta
                if (shouldIncludeKey('sta')) {
                    cmcdData.sta = getPlayerState(hls);
                }

                // msd
                if (shouldIncludeKey('msd')) {
                    if (cmcdData.msd && msdSent) {
                        delete cmcdData.msd;
                    }
                    
                    if (cmcdData.msd) {
                        msdSent = true;
                    }

                    if (!msdSent && msd) {
                        msdSent = true;
                        cmcdData.msd = msd;
                    }
                }

                // df
                if (shouldIncludeKey('df') && mediaElement && mediaElement.getVideoPlaybackQuality) {
                    value = mediaElement.getVideoPlaybackQuality().droppedVideoFrames;
                    if(value > 0){
                        cmcdData.df = value;
                    }
                }

                // sn
                if (shouldIncludeKey('sn')) {
                    sequenceNumber = sequenceNumber + 1;
                    cmcdData.sn = sequenceNumber;
                }

                return {
                    data: cmcdData,
                    requestUri,
                    
                    toJSON() {
                        return filterNullUndefined(this.data);
                    },
                    
                    toQueryString() {
                        const filtered = filterNullUndefined(this.data);
                        return Object.entries(filtered).map(([key, value]) => {
                            if (typeof value === 'string') {
                                const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                                return `${key}="${escaped}"`;
                            }
                            return `${key}=${value}`;
                        }).join(',');
                    }
                };

            } catch (e) {
                console.error('Error processing CMCD data for reporting:', e);
                return null;
            }
        }

        function sendCmcdDataReport(cmcdResult) {
            try {
                const reportUrl = new URL(config.url);
                if (currentTransmissionMode == 'json') {
                    const jsonData = cmcdResult.toJSON();
                    cmcdBatchArray.push(jsonData);
                    
                    if (cmcdBatchArray.length >= config.batchSize) {
                        sendCmcdReport(cmcdBatchArray.slice(), reportUrl);
                        cmcdBatchArray.length = 0;
                    }
                } else if (currentTransmissionMode == 'query') {
                    const queryString = cmcdResult.toQueryString();
                    reportUrl.searchParams.set('CMCD', queryString);
                    sendCmcdReport(queryString, reportUrl);
                }
            } catch (e) {
                console.error('Error sending CMCD data for reporting:', e);
            }
        }

        hls.on('hlsFragLoading', (event, data) => {
            if (data.frag && data.frag.url) {
                fragmentStartTimes.set(data.frag.url, Date.now());
            }
        });

        // Response Mode
        if (config.reportingMode == 'response'){
            hls.on('hlsFragLoaded', (event, data) => {
                const cmcdResult = processCmcdData(data, 'FRAG_LOADED');
                if (cmcdResult) {
                    addResponseModeData({
                        eventData: data,
                        cmcdData: cmcdResult.data,
                        requestUri: cmcdResult.requestUri
                    });
                    sendCmcdDataReport(cmcdResult);
                }
            });
    
            hls.on('hlsManifestLoaded', (event, data) => {
                const cmcdResult = processCmcdData(data, 'MANIFEST_LOADED');
                if (cmcdResult) {
                    addResponseModeData({
                        eventData: data,
                        cmcdData: cmcdResult.data,
                        requestUri: cmcdResult.requestUri
                    });
                    sendCmcdDataReport(cmcdResult);
                }
            });
        }

        //Event Mode
        function setupEventModeListeners() {
            const mediaElement = getMediaElement();
            if (!mediaElement || config.reportingMode !== 'event') return;

            function handleMediaEvent(eventType, cmcdEventType, additionalHandler) {
                const cmcdResult = processCmcdData({}, eventType);
                if (!cmcdResult) return;

                if (additionalHandler) {
                    additionalHandler(cmcdResult);
                }

                addEventModeData({
                    event: cmcdEventType,
                    cmcdData: cmcdResult.data
                });
                sendCmcdDataReport(cmcdResult);
            }

            const eventMappings = [
                { mediaEvent: 'playing', eventType: 'PLAYING', cmcdEvent: 'ps' },
                { mediaEvent: 'pause', eventType: 'PAUSE', cmcdEvent: 'ps' },
                { mediaEvent: 'seeking', eventType: 'SEEKING', cmcdEvent: 'ps' },
                { mediaEvent: 'waiting', eventType: 'WAITING', cmcdEvent: 'ps' },
                { mediaEvent: 'ended', eventType: 'ENDED', cmcdEvent: 'ps' }
            ];

            eventMappings.forEach(({ mediaEvent, eventType, cmcdEvent }) => {
                mediaElement.addEventListener(mediaEvent, () => {
                    handleMediaEvent(eventType, cmcdEvent);
                });
            });

            mediaElement.addEventListener('volumechange', () => {
                if (mediaElement.muted) {
                    console.log('Video has been muted');
                    handleMediaEvent('MUTED', 'm');
                } else {
                    console.log('Video is unmuted');
                    handleMediaEvent('UNMUTED', 'um');
                }
            });

            mediaElement.addEventListener('error', () => {
                handleMediaEvent('ERROR', 'e', (cmcdResult) => {
                    cmcdResult.ec = mediaElement.error?.code ?? null;
                });
            });
        }

        function setupTimeInterval(){
            if (config.timeInterval && config.timeInterval > 0) {
                setInterval(() => {
                    const cmcdResult = processCmcdData({}, 'TIME_INTERVAL');
                    if (cmcdResult) {
                        addEventModeData({
                            event: 't',
                            cmcdData: cmcdResult.data
                        });
                        sendCmcdDataReport(cmcdResult);
                    }
                }, config.timeInterval);
            }
        }
        
        // Setup event mode listeners when media is attached or immediately if already available
        if (config.reportingMode == 'event') {
            if (getMediaElement()) {
                setupEventModeListeners();
            } else {
                hls.on('hlsMediaAttached', setupEventModeListeners);
            }
        }

        // Setup time interval for periodic reporting
        setupTimeInterval();
    };

    window.hlsCmcdV2Plugin = {
        enableCmcdV2(hls, config) {
            _enableCmcdV2(hls, config);
        }
    };
})();