/*
 Copyright 2020 Esri

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import AppBase from "./support/AppBase.js";
import AppLoader from "./loaders/AppLoader.js";

class Application extends AppBase {

  // PORTAL //
  portal;

  // CENTIMETERS TO METERS CONVERSION FACTOR //
  CM_TO_METERS = 0.1;

  // FORMAT TREE SIZE - NOW IN METERS //
  sizeFormatter;

  /**
   *
   */
  constructor() {
    super();

    // SIZE FORMATTER //
    this.sizeFormatter = new Intl.NumberFormat('default', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    // LOAD APPLICATION BASE //
    super.load().then(() => {

      // APPLICATION LOADER //
      const applicationLoader = new AppLoader({app: this});
      applicationLoader.load().then(({portal, group, map, view}) => {
        //console.info(portal, group, map, view);

        // PORTAL //
        this.portal = portal;

        // APP TITLE //
        this.title = this.title || map?.portalItem?.title || 'Application';
        // APP DESCRIPTION //
        this.description = this.description || map?.portalItem?.description || group?.description || '...';

        // APPLICATION //
        this.applicationReady({portal, group, map, view}).catch(this.displayError).then(() => {
          // HIDE APP LOADER //
          document.getElementById('app-loader').removeAttribute('active');
        });

      }).catch(this.displayError);
    }).catch(this.displayError);

  }

  /**
   *
   * @param view
   */
  configView(view) {
    return new Promise((resolve, reject) => {
      if (view) {
        require([
          'esri/widgets/Home',
          'esri/widgets/Legend'
        ], (Home, Legend) => {

          //
          // CONFIGURE VIEW SPECIFIC STUFF HERE //
          //
          view.set({
            constraints: {snapToZoom: false}, highlightOptions: {
              color: 'orange', haloOpacity: 0.9, fillOpacity: 0.2
            }
          });

          // HOME //
          const home = new Home({view});
          view.ui.add(home, {position: 'top-left', index: 0});

          // LEGEND //
          const legend = new Legend({view: view});
          view.ui.add(legend, {position: 'bottom-left', index: 0});

          // VIEW UPDATING //
          this.disableViewUpdating = false;
          const viewUpdating = document.getElementById('view-updating');
          view.ui.add(viewUpdating, 'bottom-right');
          this._watchUtils.init(view, 'updating', updating => {
            (!this.disableViewUpdating) && viewUpdating.toggleAttribute('active', updating);
          });

          resolve();
        });
      } else { resolve(); }
    });
  }

  /**
   *
   * @param portal
   * @param group
   * @param map
   * @param view
   * @returns {Promise}
   */
  applicationReady({portal, group, map, view}) {
    return new Promise(async (resolve, reject) => {

      // UNSET CALCITE-TAB HEIGHT //
      const locationTab = document.getElementById('location-tab');
      this.setShadowElementStyle(locationTab, 'section', 'height', 'unset');

      // VIEW READY //
      this.configView(view).then(() => {

        //
        // TREES LAYER //
        //
        // https://services.arcgis.com/V6ZHFr6zdgNZuVG0/ArcGIS/rest/services/Berlin_Trees/FeatureServer/0
        //
        // NameNr | NameNr
        // Art_Dtsch | Type_German
        // Art_Bot | Type_Botanical
        //
        const treeTypeLayer = view.map.layers.find(l => l.title === "Street Trees in Berlin");
        treeTypeLayer.load().then(() => {

          treeTypeLayer.set({
            popupEnabled: false,
            outFields: ['OBJECTID', 'Stammumfg', 'Art_Dtsch', 'StrName', 'BEZIRK']
            //outFields: ['ObjectId', 'tree_dbh', 'spc_common', 'address', 'borough', 'nta_name', 'health']
          });

          // LOCATION FILTERS //
          this.initializeLocationFilters({view, treeTypeLayer});

          // DISPLAY LIST OF TOP 1O TREE SPECIES //
          this.displayTop10TreeTypes(treeTypeLayer).then(({treeTypeList}) => {

            // INITIALIZE HISTOGRAM //
            this.initializeTreeHistogram({view, treeTypeLayer}).then(() => {

              // CLEAR SELECTION //
              const clearSelectionBtn = document.getElementById('clear-selection-btn');
              clearSelectionBtn.addEventListener('click', () => {

                // CLEAR TILE SELECT //
                treeTypeList.querySelectorAll('calcite-tile-select').forEach(tileSelect => {
                  tileSelect.toggleAttribute('checked', false);
                });

                // UPDATE HISTOGRAM SLIDER //
                this.updateSliderBins();
              });

              // SET SPECIES SELECTION //
              treeTypeList.addEventListener('calciteTileSelectChange', (evt) => {

                // TREE SPECIES //
                const treeSpecies = evt.srcElement.value;

                // UPDATE HISTOGRAM SLIDER //
                this.updateSliderBins(treeSpecies);
              });
            });
          });
        });

        resolve();
      }).catch(reject);
    });
  }

  /**
   *
   * @param treesLayer
   * @returns {Promise<unknown>}
   */
  displayTop10TreeTypes(treesLayer) {
    return new Promise((resolve, reject) => {

      // TREE TYPE TEMPLATE = CALCITE TILE SELECT //
      const treeTypeTemplate = document.getElementById('tree-type-template');
      const _createItemNode = () => {
        const templateNode = treeTypeTemplate.content.cloneNode(true);
        return templateNode.querySelector('calcite-tile-select');
      };

      // TREE TYPE LIST //
      const treeTypeList = document.getElementById('tree-type-list');

      // TOP 1O QUERY //
      const top10Query = treesLayer.createQuery();
      top10Query.set({
        where: '(Art_Dtsch is not null)',
        groupByFieldsForStatistics: ['Art_Dtsch', 'Art_Bot'],
        outStatistics: [{"statisticType": "count", "onStatisticField": "Art_Dtsch", "outStatisticFieldName": "SpeciesCount"}],
        orderByFields: ['SpeciesCount desc'],
        num: 10
      });
      treesLayer.queryFeatures(top10Query).then((top10FS) => {
        const treeTypeItemNodes = top10FS.features.map(feature => {

          const species = feature.getAttribute('Art_Dtsch');
          const adjustedSpecies = species.replace(/??/g, 'SS').replace(/??/g, 'A').replace(/, /g, ' ').replace(/ - /g, '-').replace(/- /g, '-').replace(/ /g, '-').replace(/--/g, '-').toLowerCase();
          //console.info(species, '< === >', adjustedSpecies);

          const latin = feature.getAttribute('Art_Bot');
          const count = feature.getAttribute('SpeciesCount');

          const treeItemNode = _createItemNode();
          treeItemNode.setAttribute('heading', species.toUpperCase());
          treeItemNode.setAttribute('title', latin);
          treeItemNode.setAttribute('description', `count: ${ count.toLocaleString() }`);
          treeItemNode.setAttribute('value', species);

          const treeThumb = treeItemNode.querySelector('.tree-thumbnail');
          treeThumb.src = `./assets/trees/${ adjustedSpecies }.jpg`;

          return treeItemNode;
        });
        treeTypeList.replaceChildren(...treeTypeItemNodes);

        resolve({treeTypeList});
      });
    });
  }

  /**
   *
   *
   * @param view
   * @param treeTypeLayer
   */
  initializeTreeHistogram({view, treeTypeLayer}) {
    return new Promise((resolve, reject) => {
      require([
        "esri/core/promiseUtils",
        "esri/smartMapping/statistics/histogram",
        "esri/widgets/HistogramRangeSlider"
      ], (promiseUtils, histogram, HistogramRangeSlider) => {

        // TREE TYPE LIST //
        const treeTypeList = document.getElementById('tree-type-list');
        const disableTreeTypeList = (disabled) => {
          treeTypeList.querySelectorAll('calcite-tile-select').forEach(tileSelect => {
            tileSelect.toggleAttribute('disabled', disabled);
          });
        };

        view.whenLayerView(treeTypeLayer).then(treeTypeLayerView => {

          const statField = 'Stammumfg';
          const diameterMin = 0;
          const diameterMax = 300;

          const histogramSlider = new HistogramRangeSlider({
            container: "histogram-container",
            rangeType: "between",
            includedBarColor: '#7bb07f',
            excludedBarColor: '#e6f0e6',
            precision: 0,
            min: diameterMin,
            max: diameterMax,
            values: [diameterMin, diameterMax],
            labelFormatFunction: (value, type) => {
              return `${ this.sizeFormatter.format(value * this.CM_TO_METERS) } m`;
            },
            barCreatedFunction: (index, element) => {
              element.setAttribute("stroke-width", "0.8");
              element.setAttribute("stroke", "#f8f8f8");
            }
          });

          // UPDATE THE LAYER FILTER //
          const updateFeatureEffect = promiseUtils.debounce(() => {

            const filters = [histogramSlider.generateWhereClause(statField)];
            this.treeSpeciesFilter && filters.push(this.treeSpeciesFilter);

            treeTypeLayerView.featureEffect = {
              filter: {where: filters.join(' AND ')},
              excludedEffect: 'opacity(0.2) blur(2px)'
            };

            this._evented.emit('filter-by-type-change', {});
          });

          // DEFAULT HISTOGRAM PARAMETERS //
          const defaultHistogramParams = {
            layer: treeTypeLayer,
            field: statField,
            numBins: 50,
            minValue: diameterMin,
            maxValue: diameterMax
          };

          // TREE SPECIES FILTER //
          this.treeSpeciesFilter = null;

          // UPDATE HISTOGRAM BINS //
          this.updateSliderBins = (treeSpecies) => {
            this.treeSpeciesFilter = treeSpecies ? `(Art_Dtsch = '${ treeSpecies }')` : null;

            const params = this.treeSpeciesFilter ? {
              ...defaultHistogramParams, sqlWhere: this.treeSpeciesFilter
            } : defaultHistogramParams;

            histogram(params).then((histogramResponse) => {
              histogramSlider.set({
                bins: histogramResponse.bins
              });
              updateFeatureEffect();
            });
          };
          this.updateSliderBins();

          // UPDATE THE LAYER FILTER WHEN USER CHANGES RANGE //
          histogramSlider.watch('values', () => { updateFeatureEffect(); });

          const DIRECTION = {REVERSE: -1, FORWARD: 1};

          const animationDelay = 1000;
          let animationWindow = 6;
          let animationStep = 1;
          let animationDirection = DIRECTION.FORWARD;
          let animationIndex = diameterMin;
          let isAnimating = false;
          let timeoutHandle = null;

          /**
           * ANIMATE HISTOGRAM BINS
           */
          const animateBins = () => {
            histogramSlider.set({values: [animationIndex, animationIndex + animationWindow]});

            const isNotAtEnd = (animationDirection === DIRECTION.FORWARD)
              ? ((animationIndex + animationWindow) < diameterMax)
              : (animationIndex > diameterMin);

            if (isAnimating && isNotAtEnd) {
              animationIndex += (animationStep * animationDirection);
              timeoutHandle = setTimeout(() => {
                requestAnimationFrame(animateBins);
              }, animationDelay);
            } else {
              if (!isNotAtEnd) { resetAnimationIndex(animationDirection); }
              stopAnimation();
            }
          };

          // RESET ANIMATION INDEX //
          const resetAnimationIndex = (direction) => {
            animationIndex = (direction === DIRECTION.FORWARD)
              ? diameterMin
              : (diameterMax - animationWindow);
          };

          // START ANIMATION //
          const startAnimation = (direction) => {

            if (direction !== animationDirection) { resetAnimationIndex(direction); }
            animationDirection = direction;
            updatePlayButtons();

            disableTreeTypeList(true);
            histogramResetBtn.toggleAttribute('disabled', true);
            view.focus();

            isAnimating = true;
            requestAnimationFrame(animateBins);
          };

          // STOP ANIMATION //
          const stopAnimation = () => {
            isAnimating = false;
            clearTimeout(timeoutHandle);

            histogramPlayFBtn.toggleAttribute('active', false);
            histogramPlayRBtn.toggleAttribute('active', false);
            updatePlayButtons();

            disableTreeTypeList(false);
            histogramResetBtn.toggleAttribute('disabled', false);
            view.focus();
          };

          const histogramPlayFBtn = document.getElementById('histogram-play-f-btn');
          histogramPlayFBtn.addEventListener('click', () => {
            if (histogramPlayFBtn.toggleAttribute('active')) {
              startAnimation(DIRECTION.FORWARD);
            } else {
              stopAnimation();
            }
          });

          const histogramPlayRBtn = document.getElementById('histogram-play-r-btn');
          histogramPlayRBtn.addEventListener('click', () => {
            if (histogramPlayRBtn.toggleAttribute('active')) {
              startAnimation(DIRECTION.REVERSE);
            } else {
              stopAnimation();
            }
          });

          const updatePlayButtons = () => {
            const isFActive = histogramPlayFBtn.hasAttribute('active');
            const isRActive = histogramPlayRBtn.hasAttribute('active');

            histogramPlayFBtn.setAttribute('appearance', isFActive ? 'solid' : 'outline');
            histogramPlayFBtn.setAttribute('icon-start', isFActive ? 'pause-f' : 'forward-f');
            histogramPlayRBtn.toggleAttribute('disabled', isFActive);

            histogramPlayRBtn.setAttribute('appearance', isRActive ? 'solid' : 'outline');
            histogramPlayRBtn.setAttribute('icon-end', isRActive ? 'pause-f' : 'reverse-f');
            histogramPlayFBtn.toggleAttribute('disabled', isRActive);
          };

          // RESET MIN/MAX RANGE //
          const histogramResetBtn = document.getElementById('histogram-reset-btn');
          histogramResetBtn.addEventListener('click', () => {
            resetAnimationIndex(animationDirection);
            histogramSlider.set({values: [diameterMin, diameterMax]});
          });

          resolve();
        });
      });
    });
  }

  /**
   *
   * https://geoxc.maps.arcgis.com/home/item.html?id=eb17c8cdeef940f0a83a762a643e9e5b
   *
   * @param view
   * @param treeTypeLayer
   */
  initializeLocationSummary({view, treeTypeLayer}) {
    require([
      "esri/core/Handles",
      "esri/core/promiseUtils",
      "esri/Graphic",
      "esri/layers/GraphicsLayer",
      "esri/geometry/geometryEngine"
    ], (Handles, promiseUtils, Graphic, GraphicsLayer, geometryEngine) => {

      const highlightColor1 = '#ffa200';
      const highlightColor2 = '#ffffff';

      const locationGraphic = new Graphic({
        symbol: {
          type: 'simple-marker',
          style: "cross",
          color: highlightColor2,
          size: "15pt",
          outline: {
            color: highlightColor1, width: 3
          }
        }
      });

      const searchGraphic = new Graphic({
        symbol: {
          type: 'simple-fill',
          color: 'transparent',
          style: "diagonal-cross",
          outline: {
            color: "orange", width: 2.2
          }
        }
      });

      const getTextSymbol = (label, relativePosition) => {
        return {
          type: "text",
          color: highlightColor2,
          haloColor: highlightColor1,
          haloSize: "2px",
          text: label,
          xoffset: (relativePosition ? 15 : -15),
          verticalAlignment: 'middle',
          horizontalAlignment: (relativePosition ? 'left' : 'right'),
          font: {
            size: 15,
            family: "Avenir Next LT Pro",
            weight: 'bold'
          }
        };
      };

      const biggestLabelGraphic = new Graphic({symbol: getTextSymbol("Biggest Tree")});

      const biggestGraphic = new Graphic({
        symbol: {
          type: 'simple-marker',
          style: "circle",
          color: highlightColor2,
          size: "9pt",
          outline: {
            color: highlightColor1, width: 1.8
          }
        }
      });

      // ANALYSIS LAYER //
      const analysisGraphicsLayer = new GraphicsLayer({
        title: 'Filter by Location',
        effect: 'drop-shadow(1px,1px,1px)',
        graphics: [searchGraphic, locationGraphic, biggestGraphic, biggestLabelGraphic]
      });
      view.map.add(analysisGraphicsLayer);

      view.whenLayerView(treeTypeLayer).then(treeTypeLayerView => {

        // ABORT ERROR HANDLER //
        const _abortHandler = error => { if (error.name !== "AbortError") { console.error(error); } };

        // UPDATE SEARCH LOCATION AND AREA //
        const _updateSearchLocationAndArea = (location) => {
          locationGraphic.geometry = location;
          searchGraphic.geometry = geometryEngine.geodesicBuffer(locationGraphic.geometry, searchDistanceSlider.value, 'kilometers');
        };

        this.updateSearchLocationAndArea = (location) => {
          if (location) {
            if (!searchLocationBtn.hasAttribute('active')) {
              searchLocationBtn.click();
            }
            _updateSearchLocationAndArea(location);
            updateSummaryDetails().catch(_abortHandler);
          } else {
            if (searchLocationBtn.hasAttribute('active')) {
              searchLocationBtn.click();
            }
          }
        };

        // SUMMARY DETAILS LABELS //
        const summaryBiggestTypeLabel = document.getElementById('summary-biggest-type-label');
        const summaryBiggestAddressLabel = document.getElementById('summary-biggest-address-label');
        const summaryBiggestSizeLabel = document.getElementById('summary-biggest-size-label');
        const summaryCommonTypeLabel = document.getElementById('summary-common-type-label');
        const summaryCommonCountLabel = document.getElementById('summary-common-count-label');
        const summaryAvgSizeLabel = document.getElementById('summary-avg-size-label');

        // BIGGEST TREE //
        const getBiggestTree = promiseUtils.debounce(() => {
          if (searchGraphic.geometry) {

            const summaryQuery = treeTypeLayerView.createQuery();
            summaryQuery.set({
              geometry: searchGraphic.geometry,
              where: this.treeSpeciesFilter || '(1=1)',
              outFields: ['Stammumfg', 'Art_Dtsch', 'StrName', 'BEZIRK'],
              orderByFields: ['Stammumfg desc'],
              returnGeometry: true,
              num: 1
            });
            return treeTypeLayerView.queryFeatures(summaryQuery).then(summaryFS => {

              if (summaryFS.features.length) {

                const biggestTree = summaryFS.features[0];
                const biggestTreeAtts = biggestTree.attributes;

                const treeSpecies = biggestTreeAtts.Art_Dtsch.toUpperCase();
                const treeDiameter = this.sizeFormatter.format(biggestTreeAtts.Stammumfg * this.CM_TO_METERS);

                const streetParts = [];
                biggestTreeAtts.HausNr && streetParts.push(biggestTreeAtts.HausNr);
                biggestTreeAtts.StrName && streetParts.push(`${ biggestTreeAtts.StrName }`);
                const streetAddress = streetParts.length ? streetParts.join(' ') : '';

                const addressParts = [];
                streetAddress && addressParts.push(streetAddress);
                biggestTreeAtts.BEZIRK && addressParts.push(biggestTreeAtts.BEZIRK);
                const treeAddress = addressParts.length ? addressParts.join(', ') : 'Berlin';

                summaryBiggestTypeLabel.innerHTML = treeSpecies;
                summaryBiggestAddressLabel.innerHTML = treeAddress;
                summaryBiggestSizeLabel.innerHTML = `${ treeDiameter } m`;

                biggestGraphic.geometry = biggestTree.geometry;

                const relativePosition = (biggestTree.geometry.longitude > locationGraphic.geometry.longitude);

                biggestLabelGraphic.set({
                  geometry: biggestTree.geometry,
                  symbol: getTextSymbol(`${ treeDiameter } m ${ treeSpecies }\nlocated at ${ treeAddress }`, relativePosition)
                });

              } else {
                summaryBiggestTypeLabel.innerHTML = '';
                summaryBiggestAddressLabel.innerHTML = '';
                summaryBiggestSizeLabel.innerHTML = '';
                biggestGraphic.geometry = null;
                biggestLabelGraphic.geometry = null;
              }

            });
          } else {
            summaryBiggestTypeLabel.innerHTML = '';
            summaryBiggestAddressLabel.innerHTML = '';
            summaryBiggestSizeLabel.innerHTML = '';
            biggestGraphic.geometry = null;
            biggestLabelGraphic.geometry = null;
            return Promise.resolve();
          }
        });

        // MOST COMMON TREE //
        const getMostCommonTree = promiseUtils.debounce(() => {
          if (searchGraphic.geometry) {
            const summaryQuery = treeTypeLayerView.createQuery();
            summaryQuery.set({
              geometry: searchGraphic.geometry,
              where: this.treeSpeciesFilter || '(Art_Dtsch is not null)',
              outFields: ['Art_Dtsch'],
              groupByFieldsForStatistics: ['Art_Dtsch'],
              orderByFields: ['SpeciesCount desc'],
              outStatistics: [{"statisticType": "count", "onStatisticField": "Art_Dtsch", "outStatisticFieldName": "SpeciesCount"}],
              num: 1
            });
            return treeTypeLayerView.queryFeatures(summaryQuery).then(summaryFS => {
              if (summaryFS.features.length) {
                const mostCommonTree = summaryFS.features[0].attributes;
                summaryCommonTypeLabel.innerHTML = mostCommonTree.Art_Dtsch.toUpperCase();
                summaryCommonCountLabel.innerHTML = mostCommonTree.SpeciesCount.toLocaleString();
              } else {
                summaryCommonTypeLabel.innerHTML = '';
                summaryCommonCountLabel.innerHTML = '';
              }
            });
          } else {
            summaryCommonTypeLabel.innerHTML = '';
            summaryCommonCountLabel.innerHTML = '';
            return Promise.resolve();
          }
        });

        // AVERAGE SIZE //
        const getAverageTreeSize = promiseUtils.debounce(() => {
          if (searchGraphic.geometry) {

            const summaryQuery = treeTypeLayerView.createQuery();
            summaryQuery.set({
              geometry: searchGraphic.geometry,
              where: this.treeSpeciesFilter || '(1=1)',
              outStatistics: [{"statisticType": "avg", "onStatisticField": "Stammumfg", "outStatisticFieldName": "AvgTreeSize"}]
            });
            return treeTypeLayerView.queryFeatures(summaryQuery).then(summaryFS => {
              const stats = summaryFS.features[0].attributes;
              summaryAvgSizeLabel.innerHTML = (stats.AvgTreeSize != null) ? `${ this.sizeFormatter.format(stats.AvgTreeSize * this.CM_TO_METERS) } m` : '';
            });

          } else {
            summaryAvgSizeLabel.innerHTML = '';
            return Promise.resolve();
          }
        });

        // UPDATE SUMMARY DETAILS //
        const updateSummaryDetails = promiseUtils.debounce(() => {
          return Promise.all([
            getBiggestTree(),
            getMostCommonTree(),
            getAverageTreeSize()
          ]).catch(_abortHandler);
        });

        this._evented.on('filter-by-type-change', ({}) => {
          updateSummaryDetails().catch(_abortHandler);
        });

        // SEARCH DISTANCE SLIDER //
        const searchDistanceSlider = document.getElementById('search-distance-slider');
        searchDistanceSlider.addEventListener('calciteSliderInput', () => {
          if (locationGraphic.geometry) {
            _updateSearchLocationAndArea(locationGraphic.geometry);
            updateSummaryDetails().catch(_abortHandler);
          }
        });

        // EVENT HANDLES //
        let eventHandles = new Handles();

        // TOGGLE SEARCH LOCATION //
        const searchLocationBtn = document.getElementById('search-location-btn');
        searchLocationBtn.addEventListener('click', () => {

          // IS ACTIVE //
          const active = searchLocationBtn.toggleAttribute('active');
          searchLocationBtn.setAttribute('appearance', active ? 'solid' : 'outline');
          view.container.style.cursor = active ? 'crosshair' : 'default';

          // REMOVE ANY PREVIOUS EVENT HANDLES //
          eventHandles.removeAll();

          if (active) {
            // ENABLE SEARCH AREA EVENTS //
            enableSearchAreaEvents();

          } else {
            locationGraphic.geometry = null;
            searchGraphic.geometry = null;
            updateSummaryDetails().catch(_abortHandler);
          }
        });

        // ENABLE SEARCH AREA EVENTS //
        const enableSearchAreaEvents = () => {

          // VIEW CLICK //
          const clickHandler = view.on('click', ({mapPoint}) => {
            _updateSearchLocationAndArea(mapPoint);
            updateSummaryDetails().catch(_abortHandler);
          });

          // VIEW POINTER MOVE //
          const moveHandle = view.on('pointer-move', moveEvt => {
            view.hitTest(moveEvt, {include: [locationGraphic]}).then(({results}) => {
              view.container.style.cursor = (results?.length) ? 'move' : 'default';
            });
          });

          // VIEW DRAG //
          const dragHandle = view.on('drag', dragEvt => {
            dragEvt.stopPropagation();
            switch (dragEvt.action) {
              case 'update':
                _updateSearchLocationAndArea(view.toMap(dragEvt));
                updateSummaryDetails().catch(_abortHandler);
                break;
            }
          });

          // EVENT HANDLES //
          eventHandles.add([clickHandler, moveHandle, dragHandle]);
        };

      });
    });
  }

  /**
   *
   * @param view
   * @param treeTypeLayer
   */
  initializeLocationFilters({view, treeTypeLayer}) {

    // INITIALIZE SUMMARY //
    this.initializeLocationSummary({view, treeTypeLayer});

    //
    // SET ANALYSIS LOCATION BY ADDRESS
    //
    require(['esri/widgets/Search'], (Search) => {

      const search = new Search({
        container: 'search-container',
        view: view,
        allPlaceholder: 'Berlin address',
        locationEnabled: false,
        popupEnabled: false,
        resultGraphicEnabled: false
      });
      search.when(() => {
        const defaultSource = search.defaultSources.getItemAt(0);
        defaultSource.set({
          zoomScale: 50000,
          filter: {geometry: treeTypeLayer.fullExtent}
        });
      });
      search.on('select-result', searchResult => {
        this.updateSearchLocationAndArea(searchResult.result.feature.geometry);
      });
      search.on('search-clear', () => {
        this.updateSearchLocationAndArea();
      });

    });

  }

}

export default new Application();


