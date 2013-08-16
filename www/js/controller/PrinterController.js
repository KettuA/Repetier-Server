ScriptConfigController = function ($scope, $routeParams, WS, $rootScope, $timeout,$q) {
    slug = $routeParams.slug;
    $rootScope.selectPrinter(slug);
    $scope.scripts = [
        {name: "start", title: "Run before job"},
        {name: "end", title: "Run after job"},
        {name: "pause", title: "Run on pause"},
        {name: "kill", title: "Run if job is aborted"},
        {name: "script_1", title: "Custom script 1"},
        {name: "script_2", title: "Custom script 2"},
        {name: "script_3", title: "Custom script 3"},
        {name: "script_4", title: "Custom script 4"},
        {name: "script_5", title: "Custom script 5"}
    ];
    $scope.scriptLoaded = false;
    $scope.activeScript = $scope.scripts[0];
    $scope.scriptContent = "";
    var origScript = "";
    $scope.selectScript = function (script) {
        console.log("selectScript");
        $scope.saveScript().then(function () {
            console.log("saved");
            $scope.activeScript = script;
            WS.send("getScript", {name: script.name}).then(function (r) {
                $scope.scriptContent = origScript = r.script;
                $scope.scriptLoaded = true;
            })
        });
    }
    $scope.saveScript = function () {
        console.log("saveScript");
        var deferred = $q.defer();
        deferred.resolve();
        if ($scope.scriptLoaded == false) return deferred.promise;
        if (origScript == $scope.scriptContent) return deferred.promise;
        console.log("changed");
        $scope.scriptLoaded = false;
        return WS.send("setScript", {name: $scope.activeScript.name, script: $scope.scriptContent});
    }
    $scope.$on('$destroy', function () {
        $scope.saveScript();
    });
    WS.send("getScript", {name: $scope.activeScript.name}).then(function (r) {
        $scope.scriptContent = origScript = r.script;
        $scope.scriptLoaded = true;
    });
}

PrinterConfigController = function ($scope, $routeParams, WS, $rootScope, $timeout) {
    slug = $routeParams.slug;
    $rootScope.selectPrinter(slug);
    window.ed = $scope;
    $scope.editor = angular.copy($rootScope.printerConfig[slug]) || {};
    var preview = new GCodePainter("shapePreview");
    preview.connectPrinter($scope.editor);
    preview.disableCursor();

    $scope.$on('$destroy', function () {
        preview.$destroy();
    });

    $scope.saveConfig = function () {
        WS.send("setPrinterConfig", $scope.editor);
    }
    $scope.resetConfig = function () {
        $scope.editor = $rootScope.printerConfig[slug];
    }
    var enrichEditor = function () {
        if (!$scope.editor) return;
        bs = $scope.editor.shape.basicShape;
        if (undefined == bs.radius) {
            bs.radius = 100;
            bs.x = 0;
            bs.y = 0;
        }
        if (undefined == bs.xMin) {
            bs.xMin = bs.yMin = 0;
            bs.xMax = bs.yMax = 200;
        }
    }
    $rootScope.$watch('printerConfig.' + slug, function (newVal) {
        $scope.editor = angular.copy(newVal);
        enrichEditor();
        $timeout(function () {
            $("[data-toggle=popover]").popover({});
            preview.connectPrinter($scope.editor);
        });
    });
    $('#printerTabs a').click(function (e) {
        e.preventDefault();
        $(this).tab('show');
    })

    $scope.bedTempUp = function (idx) {
        x = $scope.editor.heatedBed.temperatures[idx - 1];
        y = $scope.editor.heatedBed.temperatures[idx];
        $scope.editor.heatedBed.temperatures.splice(idx - 1, 2, y, x);
    }
    $scope.bedTempDown = function (idx) {
        x = $scope.editor.heatedBed.temperatures[idx];
        y = $scope.editor.heatedBed.temperatures[idx + 1];
        $scope.editor.heatedBed.temperatures.splice(idx, 2, y, x);
    }
    $scope.bedTempDel = function (idx) {
        $scope.editor.heatedBed.temperatures.splice(idx, 1);
    }
    $scope.bedTempAdd = function () {
        $scope.editor.heatedBed.temperatures.push({name: "", temp: "50"});
    }
    $scope.extTempUp = function (ex, idx) {
        x = ex.temperatures[idx - 1];
        y = ex.temperatures[idx];
        ex.temperatures.splice(idx - 1, 2, y, x);
    }
    $scope.extTempDown = function (ex, idx) {
        x = ex.temperatures[idx];
        y = ex.temperatures[idx + 1];
        ex.temperatures.splice(idx, 2, y, x);
    }
    $scope.extTempDel = function (ex, idx) {
        ex.temperatures.splice(idx, 1);
    }
    $scope.extTempAdd = function (ex) {
        ex.temperatures.push({name: "", temp: "50"});
    }
    $scope.addExtruder = function () {
        $scope.editor.extruders.push({eJerk: 40, maxSpeed: 30, extrudeSpeed: 2, extrudeDistance: 10, retractSpeed: 20, retractDistance: 10, temperatures: []});
    }
    $scope.removeExtruder = function (idx) {
        if (confirm("Really delete this extruder?")) {
            $scope.editor.extruders.splice(idx, 1);
        }
    }
    $scope.$watch('editor.shape|json', function () {
        preview.updateShape();
    });
    $scope.$watch('editor.movement|json', function () {
        preview.updateShape();
    });

    //$("#printerTabs a:last").tab('show');
    $("#printerTabs a:first").tab('show');
    $timeout(function () {
        $("[data-toggle=popover]").popover({});
        enrichEditor();
    });
}
PrinterController = function ($scope, $routeParams, WS, $rootScope, $timeout) {
    slug = $routeParams.slug;
    $rootScope.selectPrinter(slug);
    $scope.logCommands = 0;
    $scope.logACK = 0;
    $scope.logPause = 0;
    $scope.logAutoscroll = 1;
    $scope.cmd = '';
    $scope.models = [];
    $scope.queue = [];
    $scope.activeGCode = false;
    $scope.activeQueue = false;
    $scope.movoToXPos = 20;
    $scope.movoToYPos = 50;
    $scope.hsliderSize = 300;
    var preview = new GCodePainter("control-view");
    preview.connectPrinter($rootScope.activeConfig);

    lastLogStart = 0;
    $scope.$on('$destroy', function () {
        preview.$destroy();
    });
    var getLoglevel = function () {
        return 12 + ($scope.logCommands > 0 ? 1 : 0) + ($scope.logACK > 0 ? 2 : 0);
    }
    var addLogLine = function (line) {
        newline = line.time + ': ' + line.text;
        $rootScope.active.log.push({c: 'log' + line.type, t: newline});
        $rootScope.active.log.splice(0, $rootScope.active.log.length - 500);
        lastLogStart = line.id;
    }
    $scope.$on("move", function (event, pos) {
        preview.addMove(pos.data);
    });
    var responsePoller = function () {
        filter = 12 + ($scope.logCommands > 0 ? 1 : 0) + ($scope.logACK > 0 ? 2 : 0);
        WS.send("response", {filter: filter, start: lastLogStart}).then(function (r) {
            /*lastLogStart = r['lastid'];
             angular.forEach(r.lines,function(line) {
             addLogLine(line);
             });
             */
            $rootScope.active.state = r.state;
            $timeout(responsePoller, 3000);
        });
    };
    var fetchPrintqueue = function () {
        WS.send("listJobs", {}).then(function (r) {
            $scope.queue = r.data;
        });
    }
    var fetchModels = function () {
        WS.send("listModels", {}).then(function (r) {
            $scope.models = r.data;
        });
    }
    $scope.$watch('logACK', function () {
        WS.send("setLoglevel", {level: getLoglevel()});
    });
    $scope.$watch('logCommands', function () {
        WS.send("setLoglevel", {level: getLoglevel()});
    });
    $scope.$on("connected", function (event) {
        fetchPrintqueue();
        fetchModels();
        WS.send("setLoglevel", {level: getLoglevel()});
    });
    $rootScope.$watch("activeConfig", function () {
        console.log("activeConfig");
        console.log($rootScope.activeConfig);
        preview.connectPrinter($rootScope.activeConfig);
        resizeContols();
    });
    $scope.$on("printqueueChanged", function (event) {
        fetchPrintqueue();
    });
    $scope.$on("jobsChanged", function (event) {
        fetchModels();
    });
    $scope.$on("log", function (event, data) {
        addLogLine(data.data);
        //$scope.$apply()
    });
    $scope.test = function (v) {
        console.log("test");
        console.log(v);
    }
    $scope.selectQueue = function (gc) {
        console.log("select queue");
        $scope.activeQueue = gc;
    }
    $scope.selectGCode = function (gc) {
        $scope.activeGCode = gc;
    }
    $scope.dequeActive = function () {
        console.log("dequeu");
        WS.send("removeJob", {id: $scope.activeQueue.id}).then(function (r) {
            //$scope.queue = r.data;
            $scope.activeQueue = false;
        });
    }
    $scope.printActiveQueue = function () {
        WS.send("startJob", {id: $scope.activeQueue.id});
    }
    $scope.deleteActiveGCode = function () {
        WS.send("removeModel", {id: $scope.activeGCode.id}).then(function (r) {
            //$scope.models = r.data;
            $scope.activeGCode = false;
            $('#deleteGCodeQuestion').foundation('reveal', 'close');
        });
    }
    $scope.uploadGCode = function () {
        $('#formuploadgcode').ajaxSubmit(function (r) {
            r = jQuery.parseJSON(r);
            $('#uploadGCode').foundation('reveal', 'close');
            //$scope.models = r.data;
        });
    }
    $scope.printGCode = function () {
        WS.send("copyModel", {id: $scope.activeGCode.id}).then(function (r) {
            /*    $scope.queue = r.data;
             if($scope.queue.length == 1) {
             WS.send("startJob",{id:$scope.queue[0].id}).then(function(r) {
             // $scope.queue = r.data;
             });
             }*/
        });
    }
    $scope.isJobActive = function () {
        return $rootScope.active.status.job != 'none';
    }
    $scope.sendCmd = function () {
        WS.send("send", {cmd: $scope.cmd});
        $scope.cmd = "";
    }
    $scope.queueFileSelected = function (q) {
        return q.id == $scope.activeQueue.id;
    }

    var resizeContols = function () {
        w = $('#control-row').width();
        p = $rootScope.activeConfig;
        if (!p) return;
        console.log("resizeControls");
        dimx = p.movement.xMax - p.movement.xMin;
        dimy = p.movement.yMax - p.movement.yMin;
        aspectP = dimx / dimy;
        pw = ph = 302;
        if (aspectP > 1) ph = pw / aspectP; else pw = ph * aspectP;
        console.log("w=" + w + " dimx " + dimx + " dimy " + dimy + " pw " + pw + " ph " + ph);
        $('#control-view').width(pw).height(ph);
        $scope.hsliderSize = pw;
        $('#control-vscoll-container').height(ph);
        preview.updateShape();
    }
    $scope.$on('windowResized', function () {
        resizeContols();
    });

    responsePoller();
    fetchModels();
    $('#printerTabs a').click(function (e) {
        e.preventDefault();
        $(this).tab('show');
    })
    //$("#printerTabs").tab();
    $("#printerTabs a:first").tab('show');
    //$timeout(function() {console.log("show");$("#printerTabs a:first").tab('show');},200);
}