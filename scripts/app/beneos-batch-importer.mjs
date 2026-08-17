/**
 * =================================================================================
 *  BENEOS BATTLEMAPS BATCH-IMPORTER UTILITY
 * =================================================================================
 * 
 *  A premium, self-contained automation script that allows GMs to fetch all available
 *  scene collections from Beneos Cloud, filter by resolution (HD vs. 4K) or keyword,
 *  and batch-import them procedurally in a single queue without manual page-reloads.
 * 
 *  DEVELOPER NOTES & MODULE COMPLIANCE:
 *  - Auth & Patreon Security: Fully compliant with Moulinette Cloud and Patreon API scopes.
 *    Honors active subscription tiers by checking `/user` details and enforces mode: "cloud-accessible"
 *    during imports. Unowned/locked packs are disabled and dimmed in the UI.
 *  - Hook & Window Overrides: Temporarily overrides Hooks.callAll, Hooks.call, Dialog.prompt,
 *    and JournalSheet.prototype.render during queue execution. This silences VTT compatibility
 *    warnings, dialog modals ("Some files didn't fully install"), and welcome page popups during
 *    the batch run, offering an uninterrupted GM flow. All VTT core states are fully restored
 *    in the finally block.
 *  - Clean Database Re-installs: Includes recursive folder cleanup (`forceReimport`) that purges
 *    VTT database entities to clear scene-packer skips, forcing a retry on missing media assets
 *    while utilizing local disk checks to skip files already on disk.
 * 
 *  FUTURE DIRECT BENEOS CLOUD HOSTING:
 *  - The batch queue loop is highly modular. If Beneos Battlemaps moves away from Moulinette and
 *    hosts manifests directly on Beneos Cloud in the future, the inner `MoulinetteImporter` wrapper
 *    and manifest-fetch can be swapped with a native Beneos scene importer pipeline, keeping the
 *    main UI, checkboxes, and filters completely intact.
 * 
 *  @author John Jenne (Discord: @AustinTiger)
 *  @author Antigravity (AI Coding Companion)
 *  @version 1.0
 *  @compatibility Foundry VTT v13+ (ApplicationV2)
 */

const serverUrl = 'https://beneos.cloud';
const apiEndpoint = `${serverUrl}/api-scenepacker.php`;

export class BeneosBatchImporterApp extends foundry.applications.api.ApplicationV2 {
    constructor(options = {}) {
        super(options);
        this._packagesFetched = false;
            this.packages = [];
            this.filteredPackages = [];
            this.filteredMaps = [];
            this.selectedPackages = new Set();
            this.searchQuery = "";
            this.showHD = false;
            this.show4K = true;
            this.showSubscribedOnly = false;
            this.filterResolution = "4k"; // "any", "4k", "hd"
            this.filterSubscribed = "any"; // "any", "subscribed", "unsubscribed"
            this.isLinked = true;
            this.isLoading = true; // Premium loading indicator state
            this.downloadedPackagesSession = new Set();
            this.installedPackagesSession = new Set();
            this.isAuthenticating = false;
            this.authProvider = "";
            this.timerSecondsLeft = 0;
            this.authTimer = null;
            this.isImporting = false;
            this.isCancelled = false;
            this.importedCount = 0;
            this.totalToImport = 0;
            this.importResults = [];
            this.currentlyImportingId = null;
            this.completedImportingIds = new Set();
            this.failedImportingIds = new Set();

            // View, Group, and Layout Modes
            this.viewMode = "pack"; // "pack" or "map"
            this.groupMode = "ungroup"; // "group" or "ungroup"
            this.viewLayout = "list"; // "list" or "grid"

            // Sidebar Filters
            this.filterBiome = "any";
            this.filterBrightness = "any";
            this.filterGrid = "any";
            this.filterType = "any";
            this.filterCampaign = "any";
            this.filterRelease = "any";
            this.filterShow = "any"; // "any", "downloaded", "not_downloaded", "installed", "not_installed"

            // Sidebar Options
            this.optionCleanInstall = true;
            this.optionAutoDetect = true;
            this.optionDownload = true;
            this.optionInstall = true;
            this.optionSuppressScenePacker = true;
            this.optionSuppressBeneos = true;
            this.optionShowInfoPanel = true;

            // Compiled lists
            this.metadataLists = null;

            // Auto-resume state tracking
            this.resumeQueueList = null;
            this.importedSinceReload = 0;

            // Highly optimized caches to avoid redundant heavy O(M) scans and regexes
            this.metadataCache = new Map();
            this.thumbnailCache = new Map();
            this.constituentMapsCache = new Map();
            this.campaignNameCache = new Map();
            this.collectionNameCache = new Map();
            this.installStatusCache = new Map();
            this.downloadStatusCache = new Map();

            // Load saved state if present in sessionStorage
            const savedStateStr = sessionStorage.getItem("beneos-batch-importer-resume-state");
            if (savedStateStr) {
                try {
                    const savedState = JSON.parse(savedStateStr);
                    if (savedState && typeof savedState === "object") {
                        this.viewMode = savedState.viewMode ?? "pack";
                        this.groupMode = savedState.groupMode ?? "ungroup";
                        this.viewLayout = savedState.viewLayout ?? "list";
                        this.filterBiome = savedState.filterBiome ?? "any";
                        this.filterBrightness = savedState.filterBrightness ?? "any";
                        this.filterGrid = savedState.filterGrid ?? "any";
                        this.filterType = savedState.filterType ?? "any";
                        this.filterCampaign = savedState.filterCampaign ?? "any";
                        this.filterRelease = savedState.filterRelease ?? "any";
                        this.filterShow = savedState.filterShow ?? "any";
                        this.filterResolution = savedState.filterResolution ?? "any";
                        this.filterSubscribed = savedState.filterSubscribed ?? "any";
                        if (savedState.filterResolution === undefined) {
                            if (savedState.showHD && !savedState.show4K) this.filterResolution = "hd";
                            else if (!savedState.showHD && savedState.show4K) this.filterResolution = "4k";
                            else this.filterResolution = "any";
                        }
                        if (savedState.filterSubscribed === undefined && savedState.showSubscribedOnly !== undefined) {
                            this.filterSubscribed = savedState.showSubscribedOnly ? "subscribed" : "any";
                        }
                        this.showHD = savedState.showHD ?? false;
                        this.show4K = savedState.show4K ?? true;
                        this.showSubscribedOnly = savedState.showSubscribedOnly ?? false;
                        this.optionCleanInstall = savedState.optionCleanInstall ?? true;
                        this.optionAutoDetect = savedState.optionAutoDetect ?? true;
                        this.optionDownload = savedState.optionDownload ?? true;
                        this.optionInstall = savedState.optionInstall ?? true;
                        this.optionSuppressScenePacker = savedState.optionSuppressScenePacker ?? true;
                        this.optionSuppressBeneos = savedState.optionSuppressBeneos ?? true;
                        this.optionShowInfoPanel = savedState.optionShowInfoPanel ?? true;
                        this.importResults = savedState.importResults || [];
                        this.importedCount = savedState.importedCount || 0;
                        this.totalToImport = savedState.totalToImport || 0;
                        this.resumeQueueList = savedState.remainingIds || [];
                        console.log("Beneos Batch Importer | Loaded active resume session state:", savedState);
                    }
                } catch (e) {
                    console.error("Beneos Batch Importer | Error parsing saved resume state:", e);
                }
            }
        }

        static DEFAULT_OPTIONS = {
            id: "beneos-batch-importer",
            tag: "div",
            window: {
                title: "Beneos Battlemaps Batch-Importer v1.0",
                icon: "beneos-icon-logo",
                resizable: true,
                controls: []
            },
            position: {
                width: 1080,
                height: 1040
            },
            classes: ["beneos-batch-importer-window", "beneos-cloud-app"]
        };

        async _renderHTML(context, options) {
            return this._renderInner();
        }

        _replaceHTML(result, content, options) {
            content.replaceChildren(result[0]);
            this._setupListeners(result);
        }

        _onRender(context, options) {
            super._onRender(context, options);
            
            // Auto fetch packages on first render
            if (!this._packagesFetched) {
                this._packagesFetched = true;
                this.fetchPackages();
            }

            // Auto-run batch import queue if resuming
            if (this.resumeQueueList && this.resumeQueueList.length > 0 && !this.isImporting) {
                this.logStatus("--------------------------------------------------------------------------------", "info");
                this.logStatus("[V8 Heap Guard] Active resume session found. Auto-running queue in 2 seconds...", "success");
                this.logStatus("--------------------------------------------------------------------------------", "info");
                setTimeout(() => {
                    const html = $(this.element);
                    if (html.length && !this.isImporting) {
                        this.runBatchImport(html);
                    }
                }, 2000);
            }
        }

        async close(options = {}) {
            if (this.isImporting) {
                this.isCancelled = true;
                this.logStatus("Stopping import queue...");
            }
            if (this.authTimer) {
                clearInterval(this.authTimer);
                this.authTimer = null;
            }
            return super.close(options);
        }

        /**
         * Fetch package catalogs from Moulinette Cloud API
         * Supports mode: "cloud-all" to build checklists and mode: "cloud-accessible" to map subscription ownership
         */
         async fetchPackages() {
            if (!game.beneos?.databaseHolder?.getAll) {
                this.logStatus("Beneos Database not fully loaded yet. Deferring package retrieval...");
                setTimeout(() => this.fetchPackages(), 250);
                return [];
            }

            // Clear O(1) performance caches when refetching package lists
            this.metadataCache?.clear();
            this.thumbnailCache?.clear();
            this.constituentMapsCache?.clear();
            this.campaignNameCache?.clear();
            this.collectionNameCache?.clear();
            this.installStatusCache?.clear();
            this.downloadStatusCache?.clear();

            // Scan actual files on disk for downloaded status
            await this.scanLocalDownloadedPacks();

            const client = game.modules.get("moulinette")?.cloudclient;
            const mtSession = game.settings.get("moulinette", "session_ID") || "";
            const moulinette = game.modules.get("moulinette");
            
            // Check active Patreon/Discord connection status
            let mtUser = null;
            try {
                if (moulinette?.cloudclient?.getUser) {
                    mtUser = await moulinette.cloudclient.getUser(true);
                }
            } catch (e) {
                console.error("Beneos Batch Importer | Error fetching user status:", e);
            }
            this.isLinked = !!(mtUser && mtUser.fullName && (mtUser.user_id || mtUser.discord_user_id));

            if (!client || !mtSession || mtSession === "anonymous" || !this.isLinked) {
                this.packages = [];
                this.filteredPackages = [];
                this.isLoading = false;
                this.render({ force: true });
                if (!client || !mtSession || mtSession === "anonymous") {
                    this.logError("Moulinette Cloud session not found. Please log into Moulinette Cloud.");
                    ui.notifications.error("Moulinette Cloud session not found. Please log in to Moulinette Cloud to connect.", { permanent: true });
                } else if (!this.isLinked) {
                    this.logError("Moulinette account is not linked to Patreon or Discord! Click 'Link via Patreon/Discord' below to sign in.");
                    ui.notifications.error("Moulinette account is not linked to Patreon or Discord. Please link your account to gain access to battlemaps.", { permanent: true });
                }
                return [];
            }

            try {
                this.logStatus("Fetching available collections from Moulinette Cloud...");
                
                // 1. Fetch all packages to display in catalog checklist (type: 2 = map assets)
                const responseAll = await client.apiPOST("/packs", { 
                    creator: "Beneos Battlemaps",
                    type: 2, 
                    scope: {
                        session: mtSession,
                        mode: "cloud-all"
                    }
                });
                const rawAllPacks = Array.isArray(responseAll) ? responseAll : (responseAll?.packs || []);

                // 2. Fetch accessible (owned) packages to map active Patreon subscription tier ownership
                const responseOwned = await client.apiPOST("/packs", { 
                    creator: "Beneos Battlemaps",
                    type: 2,
                    scope: {
                        session: mtSession,
                        mode: "cloud-accessible"
                    }
                });
                const rawOwnedPacks = Array.isArray(responseOwned) ? responseOwned : (responseOwned?.packs || []);
                const ownedIds = new Set(rawOwnedPacks.map(pkg => pkg.pack_ref || pkg.id));

                this.packages = rawAllPacks.map(pkg => {
                    const id = pkg.pack_ref || pkg.id;
                    return {
                        id: id,
                        name: pkg.name,
                        cover_image: pkg.cover_image || pkg.img || pkg.cover || pkg.icon || "",
                        author: pkg.creator || "Beneos Battlemaps",
                        version: pkg.version || "1.0.0",
                        system: pkg.system || game.system.id,
                        description: pkg.description || "",
                        isOwned: ownedIds.has(id)
                    };
                });

                this.packages.sort((a, b) => a.name.localeCompare(b.name));
                this.logSuccess(`Successfully loaded ${this.packages.length} collections (${ownedIds.size} subscribed) from Moulinette Cloud.`);
                this.compileFilterMetadata();
                this.applyFilters();
            } catch (error) {
                console.error("Beneos Batch Importer | Moulinette Fetch Error:", error);
                this.logError(`Failed to fetch packages from Moulinette: ${error.message}`);
                ui.notifications.error(`Moulinette Cloud Error: ${error.message}`);
            } finally {
                this.isLoading = false;
                this.render({ force: true });
            }
        }

        /**
         * Compiles unique biome, brightness, grid size, type, campaign, and release options from the database
         */
        compileFilterMetadata() {
            const bmaps = game.beneos?.databaseHolder?.getAll?.("bmap") || {};
            const biomes = new Set();
            const brightnesses = new Set();
            const gridSizes = new Set();
            const types = new Set();
            const campaigns = new Set();
            const releases = new Set();

            for (const [key, bmap] of Object.entries(bmaps)) {
                const props = bmap.properties || {};
                if (props.biom) {
                    if (Array.isArray(props.biom)) props.biom.forEach(b => biomes.add(b));
                    else biomes.add(props.biom);
                }
                if (props.brightness) brightnesses.add(props.brightness);
                if (props.grid) gridSizes.add(props.grid);
                if (props.type) {
                    if (Array.isArray(props.type)) props.type.forEach(t => types.add(t));
                    else types.add(props.type);
                }
                if (props.adventure) {
                    if (Array.isArray(props.adventure)) props.adventure.forEach(c => { if (c && typeof c === "string" && c.toLowerCase() !== "none") campaigns.add(c); });
                    else if (typeof props.adventure === "string" && props.adventure.toLowerCase() !== "none") campaigns.add(props.adventure);
                }
                if (props.campaign) {
                    if (Array.isArray(props.campaign)) props.campaign.forEach(c => { if (c && typeof c === "string" && c.toLowerCase() !== "none") campaigns.add(c); });
                    else if (typeof props.campaign === "string" && props.campaign.toLowerCase() !== "none") campaigns.add(props.campaign);
                }
                if (props.download_pack) {
                    releases.add(props.download_pack);
                }
            }

            // Bulletproof fallback to search-engine eager pre-compiled collections lists
            if (campaigns.size === 0 && game.beneos?.databaseHolder?.adventureList) {
                Object.keys(game.beneos.databaseHolder.adventureList).forEach(c => {
                    if (c && c.toLowerCase() !== "none") campaigns.add(c);
                });
            }
            if (biomes.size === 0 && game.beneos?.databaseHolder?.bmapBioms) {
                Object.keys(game.beneos.databaseHolder.bmapBioms).forEach(b => biomes.add(b));
            }
            if (brightnesses.size === 0 && game.beneos?.databaseHolder?.bmapBrightness) {
                Object.keys(game.beneos.databaseHolder.bmapBrightness).forEach(b => brightnesses.add(b));
            }

            this.metadataLists = {
                biomes: Array.from(biomes).sort(),
                brightnesses: Array.from(brightnesses).sort(),
                gridSizes: Array.from(gridSizes).sort(),
                types: Array.from(types).sort(),
                campaigns: Array.from(campaigns).sort(),
                releases: Array.from(releases).sort()
            };
        }

        formatFilterLabel(val) {
            if (!val) return "Unknown";
            return String(val).split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }

        /**
         * Applies search queries, keyword filters, and HD/4K resolution matching
         */
        applyFilters() {
            // 1. First, compile filteredMaps from the database holder (individual bmaps)
            const allMaps = Object.entries(game.beneos?.databaseHolder?.getAll?.("bmap") || {});
            const compiledMapsList = [];

            for (const [key, data] of allMaps) {
                const props = data.properties || {};
                const nameLower = data.name.toLowerCase();
                
                // 1. Text Search matching
                const matchesSearch = nameLower.includes(this.searchQuery.toLowerCase());
                if (!matchesSearch) continue;

                // 2. Biome filter
                if (this.filterBiome && this.filterBiome !== "any") {
                    let matchesBiome = false;
                    if (Array.isArray(props.biom)) {
                        matchesBiome = props.biom.some(b => b.toLowerCase() === this.filterBiome.toLowerCase());
                    } else {
                        matchesBiome = props.biom && props.biom.toLowerCase() === this.filterBiome.toLowerCase();
                    }
                    if (!matchesBiome) continue;
                }

                // 3. Brightness filter
                if (this.filterBrightness && this.filterBrightness !== "any") {
                    const matchesBrightness = props.brightness && props.brightness.toLowerCase() === this.filterBrightness.toLowerCase();
                    if (!matchesBrightness) continue;
                }
                
                // 4. Grid size filter
                if (this.filterGrid && this.filterGrid !== "any") {
                    const matchesGrid = props.grid && String(props.grid) === String(this.filterGrid);
                    if (!matchesGrid) continue;
                }
                
                // 5. Type filter
                if (this.filterType && this.filterType !== "any") {
                    let matchesType = false;
                    if (Array.isArray(props.type)) {
                        matchesType = props.type.some(t => t.toLowerCase() === this.filterType.toLowerCase());
                    } else {
                        matchesType = props.type && props.type.toLowerCase() === this.filterType.toLowerCase();
                    }
                    if (!matchesType) continue;
                }

                // 6. Campaign filter
                if (this.filterCampaign && this.filterCampaign !== "any") {
                    let matchesCampaign = false;
                    if (props.adventure) {
                        if (Array.isArray(props.adventure)) {
                            matchesCampaign = props.adventure.some(c => c.toLowerCase() === this.filterCampaign.toLowerCase());
                        } else {
                            matchesCampaign = props.adventure.toLowerCase() === this.filterCampaign.toLowerCase();
                        }
                    }
                    if (!matchesCampaign) continue;
                }
                
                // 7. Release filter
                if (this.filterRelease && this.filterRelease !== "any") {
                    const matchesRelease = props.download_pack && props.download_pack.toLowerCase() === this.filterRelease.toLowerCase();
                    if (!matchesRelease) continue;
                }

                // Find corresponding packages in this.packages with robust suffix stripping
                const basePack = props.download_pack?.toLowerCase();
                const matchingPackages = this.packages.filter(pkg => {
                    const pkgNameLower = pkg.name.toLowerCase();
                    if (!basePack) return false;

                    const getTrailingDashNumber = (str) => {
                        const withoutRes = str.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/, "").trim();
                        const match = withoutRes.match(/-\s*(\d+)$/);
                        return match ? match[1] : null;
                    };

                    const pkgNum = getTrailingDashNumber(pkgNameLower);
                    const baseNum = getTrailingDashNumber(basePack);
                    if (pkgNum && baseNum && pkgNum !== baseNum) {
                        return false;
                    }
                    
                    // Robust suffix and release number cleaning
                    const cleanPkg = pkgNameLower.replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/, "").replace(/[^a-z0-9]/g, "");
                    const cleanBase = basePack.replace(/\s*-\s*\d+$/, "").replace(/[^a-z0-9]/g, "");
                    
                    return cleanPkg.includes(cleanBase) || cleanBase.includes(cleanPkg);
                });

                if (matchingPackages.length === 0) {
                    // Fallback in case package matching fails, yield base card as HD
                    if (this.showHD && !this.showSubscribedOnly) {
                        const isDownloaded = this.checkDownloadStatus(null, props.download_pack);
                        const installStatus = this.checkInstallStatus(props.download_pack, null);
                        const isInstalled = installStatus === "installed";
                        
                        if (this.filterShow === "downloaded" && !isDownloaded) continue;
                        if (this.filterShow === "not_downloaded" && isDownloaded) continue;
                        if (this.filterShow === "installed" && !isInstalled) continue;
                        if (this.filterShow === "not_installed" && isInstalled) continue;

                        compiledMapsList.push({
                            key: key,
                            name: data.name,
                            properties: props,
                            is4K: false,
                            isOwned: true,
                            packageId: null
                        });
                    }
                    continue;
                }

                for (const pkg of matchingPackages) {
                    const pkgNameLower = pkg.name.toLowerCase();
                    const is4K = pkgNameLower.includes("4k") || pkgNameLower.includes("uhd") || pkgNameLower.includes("ultra hd");
                    const isHD = !is4K;

                    // Resolution filtering
                    let matchesResolution = true;
                    if (this.filterResolution === "4k") {
                        matchesResolution = is4K;
                    } else if (this.filterResolution === "hd") {
                        matchesResolution = isHD;
                    }
                    if (!matchesResolution) continue;

                    // Subscribed Only filtering
                    let matchesSubscribed = true;
                    if (this.filterSubscribed === "subscribed") {
                        matchesSubscribed = pkg.isOwned;
                    } else if (this.filterSubscribed === "unsubscribed") {
                        matchesSubscribed = !pkg.isOwned;
                    }
                    if (!matchesSubscribed) continue;

                    // Show Status filter
                    const isDownloaded = this.checkDownloadStatus(pkg.id, pkg.name);
                    const installStatus = this.checkInstallStatus(pkg.name, pkg.id);
                    const isInstalled = installStatus === "installed";
                    
                    if (this.filterShow === "downloaded" && !isDownloaded) continue;
                    if (this.filterShow === "not_downloaded" && isDownloaded) continue;
                    if (this.filterShow === "installed" && !isInstalled) continue;
                    if (this.filterShow === "not_installed" && isInstalled) continue;

                    compiledMapsList.push({
                        key: key,
                        name: data.name,
                        properties: props,
                        is4K: is4K,
                        isOwned: pkg.isOwned,
                        packageId: pkg.id
                    });
                }
            }

            this.filteredMaps = compiledMapsList;
            this.filteredMaps.sort((a, b) => a.name.localeCompare(b.name));

            // 2. Second, compile filteredPackages (Moulinette packages)
            this.filteredPackages = this.packages.filter(pkg => {
                const nameLower = pkg.name.toLowerCase();
                
                // 1. Text Search matching
                const matchesSearch = nameLower.includes(this.searchQuery.toLowerCase());
                if (!matchesSearch) return false;

                // 2. Subscribed Filter
                let matchesSubscribed = true;
                if (this.filterSubscribed === "subscribed") {
                    matchesSubscribed = pkg.isOwned;
                } else if (this.filterSubscribed === "unsubscribed") {
                    matchesSubscribed = !pkg.isOwned;
                }
                if (!matchesSubscribed) return false;

                // 3. Resolution Filter matching
                const is4K = nameLower.includes("4k") || nameLower.includes("uhd") || nameLower.includes("ultra hd");
                const isHD = !is4K;
                let matchesResolution = true;
                if (this.filterResolution === "4k") {
                    matchesResolution = is4K;
                } else if (this.filterResolution === "hd") {
                    matchesResolution = isHD;
                }
                if (!matchesResolution) return false;

                // 4. Show Status filter
                const isDownloaded = this.checkDownloadStatus(pkg.id, pkg.name);
                const installStatus = this.checkInstallStatus(pkg.name, pkg.id);
                const isInstalled = installStatus === "installed";
                
                if (this.filterShow === "downloaded" && !isDownloaded) return false;
                if (this.filterShow === "not_downloaded" && isDownloaded) return false;
                if (this.filterShow === "installed" && !isInstalled) return false;
                if (this.filterShow === "not_installed" && isInstalled) return false;

                // 5. Advanced Filter matching (if any are active)
                const hasAdvancedFilters = (
                    (this.filterBiome && this.filterBiome !== "any") ||
                    (this.filterBrightness && this.filterBrightness !== "any") ||
                    (this.filterGrid && this.filterGrid !== "any") ||
                    (this.filterType && this.filterType !== "any") ||
                    (this.filterCampaign && this.filterCampaign !== "any") ||
                    (this.filterRelease && this.filterRelease !== "any")
                );

                if (hasAdvancedFilters) {
                    // Match map packs matching the advanced filter maps list
                    return this.filteredMaps.some(map => {
                        const packName = map.properties?.download_pack;
                        return packName && nameLower.includes(packName.toLowerCase());
                    });
                }

                return true;
            });
        }

        /**
         * Renders the custom window layout dynamically with robust CSS variables
         */
        async _renderInner(data) {
            if (!this.metadataLists) {
                this.compileFilterMetadata();
            }

            const totalSelected = this.selectedPackages.size;
            const visibleSelected = Array.from(this.selectedPackages).filter(id => this.filteredPackages.some(pkg => pkg.id === id)).length;

            // Compile dropdown filter options HTML
            const biomeOptions = `<option value="any" ${this.filterBiome === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.biomes || []).map(b => `<option value="${b}" ${this.filterBiome === b ? 'selected' : ''}>${this.formatFilterLabel(b)}</option>`).join('');

            const brightnessOptions = `<option value="any" ${this.filterBrightness === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.brightnesses || []).map(b => `<option value="${b}" ${this.filterBrightness === b ? 'selected' : ''}>${this.formatFilterLabel(b)}</option>`).join('');

            const gridOptions = `<option value="any" ${this.filterGrid === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.gridSizes || []).map(g => `<option value="${g}" ${this.filterGrid === g ? 'selected' : ''}>${g}</option>`).join('');

            const typeOptions = `<option value="any" ${this.filterType === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.types || []).map(t => `<option value="${t}" ${this.filterType === t ? 'selected' : ''}>${this.formatFilterLabel(t)}</option>`).join('');

            const campaignOptions = `<option value="any" ${this.filterCampaign === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.campaigns || []).map(c => `<option value="${c}" ${this.filterCampaign === c ? 'selected' : ''}>${c}</option>`).join('');

            const releaseOptions = `<option value="any" ${this.filterRelease === 'any' ? 'selected' : ''}>Any</option>` +
                (this.metadataLists?.releases || []).map(r => `<option value="${r}" ${this.filterRelease === r ? 'selected' : ''}>${r}</option>`).join('');

            const html = $(`
                <div class="beneos-bi-container">
                    <style>
                        .beneos-batch-importer-window .window-content {
                            background: #0c0a09;
                            color: #ebe9e5;
                            padding: 0;
                            margin: 0;
                            font-family: "Signika", sans-serif;
                            height: 100%;
                            overflow: hidden;
                        }
                        
                        /* Premium Themed Dialog Customizations */
                        .beneos-bi-guide-dialog.window-app {
                            font-family: "Signika", sans-serif !important;
                            background: #0c0a09 !important;
                            border: 1px solid #c89c5e !important;
                            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8) !important;
                            border-radius: 6px !important;
                            opacity: 1 !important;
                        }
                        .beneos-bi-guide-dialog.window-app .window-header {
                            background: #151210 !important;
                            border-bottom: 1px solid #2e2920 !important;
                            color: #ebe9e5 !important;
                            padding: 8px 12px !important;
                            font-family: "Signika", sans-serif !important;
                            opacity: 1 !important;
                        }
                        .beneos-bi-guide-dialog.window-app .window-header .window-title {
                            color: #ebe9e5 !important;
                            font-family: "Signika", sans-serif !important;
                            font-size: 14px !important;
                            font-weight: 500 !important;
                            letter-spacing: 0.02em !important;
                        }
                        .beneos-bi-guide-dialog.window-app .window-content {
                            background: #0c0a09 !important;
                            color: #ebe9e5 !important;
                            padding: 16px !important;
                            font-family: "Signika", sans-serif !important;
                        }
                        .beneos-bi-guide-dialog.window-app .dialog-buttons {
                            background: #151210 !important;
                            border-top: 1px solid #2e2920 !important;
                            padding: 10px !important;
                            gap: 8px !important;
                        }
                        .beneos-bi-guide-dialog.window-app .dialog-button {
                            background: #242019 !important;
                            color: #ebe9e5 !important;
                            border: 1px solid #c89c5e !important;
                            border-radius: 4px !important;
                            cursor: pointer !important;
                            font-weight: bold !important;
                            font-family: "Signika", sans-serif !important;
                            padding: 6px 12px !important;
                            transition: all 0.2s ease !important;
                            box-shadow: none !important;
                        }
                        .beneos-bi-guide-dialog.window-app .dialog-button:hover {
                            background: #c89c5e !important;
                            color: #0c0a09 !important;
                            box-shadow: 0 0 10px rgba(200, 156, 94, 0.4) !important;
                        }
                        .beneos-bi-guide-dialog.window-app button.close,
                        .beneos-bi-guide-dialog.window-app a.close,
                        .beneos-bi-guide-dialog.window-app .header-control.close {
                            font-size: 0 !important;
                            color: #ebe9e5 !important;
                        }
                        .beneos-bi-guide-dialog.window-app button.close i,
                        .beneos-bi-guide-dialog.window-app a.close i,
                        .beneos-bi-guide-dialog.window-app .header-control.close i {
                            font-size: 14px !important;
                        }
                        .beneos-bi-container {
                            display: flex;
                            flex-direction: column;
                            height: 100%;
                        }
                        
                        /* Re-style VTT window frame headers */
                        .beneos-batch-importer-window .window-header {
                            background: #151210 !important;
                            border-bottom: 1px solid #2e2920 !important;
                            color: #ebe9e5 !important;
                            padding: 8px 12px !important;
                            font-family: "Signika", sans-serif !important;
                        }
                        .beneos-batch-importer-window .window-header .window-title {
                            color: #ebe9e5 !important;
                            font-family: "Signika", sans-serif !important;
                            font-size: 14px !important;
                            font-weight: 500 !important;
                            letter-spacing: 0.02em;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }
                        .beneos-batch-importer-window .window-header button.header-control {
                            color: #ebe9e5 !important;
                            background: transparent !important;
                            border: 1px solid transparent !important;
                            border-radius: 4px !important;
                            opacity: 1 !important;
                        }
                        .beneos-batch-importer-window .window-header button.header-control:hover {
                            color: #ffd8a4 !important;
                            background: #2c2721 !important;
                            border-color: #2e2920 !important;
                        }

                        /* Layout styling */
                        .beneos-bi-main-layout {
                            display: flex;
                            flex: 1;
                            min-height: 0;
                            gap: 12px;
                        }
                        
                        /* Left sidebar styling */
                        .beneos-bi-sidebar {
                            width: 320px;
                            background: #151210;
                            border-right: 1px solid #2e2920;
                            padding: 16px;
                            display: flex;
                            flex-direction: column;
                            gap: 16px;
                            flex-shrink: 0;
                            overflow-y: auto;
                        }
                        
                        .beneos-bi-sidebar-section {
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
                        
                        .beneos-bi-sidebar-title {
                            font-size: 11px;
                            text-transform: uppercase;
                            letter-spacing: 0.06em;
                            color: #f5c992;
                            font-weight: bold;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        
                        .beneos-bi-reset-search {
                            color: #a59d8e;
                            cursor: pointer;
                            font-size: 10px;
                            text-transform: uppercase;
                            font-weight: normal;
                            transition: color 0.12s;
                        }
                        .beneos-bi-reset-search:hover {
                            color: #ebe9e5;
                        }

                        /* Right main content area styling */
                        .beneos-bi-content-area {
                            flex: 1;
                            background: #0c0a09;
                            padding: 16px;
                            display: flex;
                            flex-direction: column;
                            gap: 12px;
                            min-width: 0;
                            min-height: 0;
                        }
                        
                        .beneos-bi-auth-alert {
                            background: rgba(216, 130, 112, 0.12);
                            border: 1px solid rgba(216, 130, 112, 0.3);
                            color: #d88270;
                            padding: 8px 12px;
                            border-radius: 4px;
                            font-size: 0.9em;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }
                        .beneos-bi-auth-alert.patreon-alert {
                            background: rgba(255, 66, 77, 0.08);
                            border: 1px solid #FF424D;
                            color: #ff8f95;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                        }
                        
                        .beneos-bi-search {
                            width: 100%;
                            background: #0c0a09 !important;
                            border: 1px solid #2e2920 !important;
                            color: #ebe9e5 !important;
                            border-radius: 4px;
                            padding: 6px 10px;
                            box-sizing: border-box;
                        }
                        .beneos-bi-search:focus {
                            border-color: #c89c5e !important;
                            box-shadow: 0 0 4px rgba(200, 156, 94, 0.4);
                        }

                        .beneos-bi-select {
                            width: 100%;
                            background: #0c0a09 !important;
                            border: 1px solid #2e2920 !important;
                            color: #ebe9e5 !important;
                            border-radius: 4px;
                            padding: 5px 8px;
                            box-sizing: border-box;
                        }
                        .beneos-bi-select:focus {
                            border-color: #c89c5e !important;
                        }
                        
                        .beneos-bi-checkbox-group {
                            display: flex;
                            flex-direction: column;
                            gap: 10px;
                        }
                        .beneos-bi-checkbox-group label {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            cursor: pointer;
                            font-size: 13px;
                            color: #ebe9e5;
                            user-select: none;
                        }
                        .beneos-bi-checkbox-group input[type="checkbox"] {
                            margin: 0;
                            width: 14px;
                            height: 14px;
                            accent-color: #c89c5e;
                        }
                        
                        .beneos-bi-btn-secondary {
                            background: #242019;
                            color: #ebe9e5;
                            border: 1px solid #2e2920;
                            border-radius: 4px;
                            padding: 5px 10px;
                            cursor: pointer;
                            font-size: 12px;
                            font-family: inherit;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            transition: background 0.12s, border-color 0.12s, color 0.12s;
                        }
                        .beneos-bi-btn-secondary:hover {
                            background: #2c2721;
                            border-color: #4a4233;
                        }
                        .beneos-bi-btn-secondary:disabled {
                            opacity: 0.5;
                            cursor: not-allowed;
                        }
                        
                        /* View Mode Toggle Segment */
                        .beneos-bi-view-toggle {
                            display: inline-flex;
                            background: #151210;
                            border: 1px solid #2e2920;
                            border-radius: 4px;
                            padding: 2px;
                            gap: 2px;
                        }
                        .beneos-bi-view-btn {
                            background: transparent;
                            border: none;
                            color: #a59d8e;
                            padding: 4px 10px;
                            font-size: 11px;
                            font-family: inherit;
                            cursor: pointer;
                            border-radius: 3px;
                            display: flex;
                            align-items: center;
                            gap: 5px;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-view-btn:hover {
                            color: #ebe9e5;
                            background: #242019;
                        }
                        .beneos-bi-view-btn.active {
                            color: #0c0a09;
                            background: #c89c5e;
                            font-weight: bold;
                        }

                        /* Kebab Menu ⋮ */
                        .beneos-bi-bulk-dropdown-container {
                            position: relative;
                            display: inline-block;
                        }
                        .beneos-bi-bulk-dropdown-trigger {
                            background: #151210;
                            border: 1px solid #2e2920;
                            color: #ebe9e5;
                            border-radius: 4px;
                            width: 26px;
                            height: 26px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            cursor: pointer;
                            transition: background 0.12s, border-color 0.12s;
                        }
                        .beneos-bi-bulk-dropdown-trigger:hover {
                            background: #242019;
                            border-color: #4a4233;
                        }
                        .beneos-bi-bulk-dropdown-menu {
                            display: none;
                            position: absolute;
                            left: 0;
                            top: 30px;
                            background: #151210;
                            border: 1px solid #2e2920;
                            border-radius: 6px;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
                            z-index: 1000;
                            min-width: 250px;
                            padding: 4px 0;
                        }
                        .beneos-bi-bulk-dropdown-menu.open {
                            display: block;
                        }
                        .beneos-bi-bulk-dropdown-item {
                            width: 100%;
                            background: transparent;
                            border: none;
                            color: #ebe9e5;
                            padding: 8px 12px;
                            text-align: left !important;
                            justify-content: flex-start !important;
                            cursor: pointer;
                            font-family: inherit;
                            font-size: 12px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-bulk-dropdown-item:hover {
                            background: #242019;
                            color: #c89c5e;
                        }

                        /* Package List Container */
                        .beneos-bi-list-wrapper {
                            flex: 1;
                            overflow-y: auto;
                            border: 1px solid #2e2920;
                            border-radius: 6px;
                            background: #0f0e0c;
                            padding: 8px;
                            min-height: 0;
                        }
                        .beneos-bi-list {
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
                        .beneos-bi-item {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            background: #242019;
                            border: 1px solid #2e2920;
                            border-radius: 5px;
                            padding: 8px 12px;
                            transition: background 0.12s, border-color 0.12s;
                        }
                        .beneos-bi-item:hover {
                            background: #2c2721;
                            border-color: #4a4233;
                        }
                        .beneos-bi-thumbnail {
                            width: 60px;
                            height: 60px;
                            object-fit: cover;
                            border-radius: 4px;
                            border: 1px solid #2e2920;
                            background: #0f0e0c;
                            flex-shrink: 0;
                        }
                        .beneos-bi-info {
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            min-width: 0;
                        }
                        .beneos-bi-name {
                            font-size: 13px;
                            font-weight: bold;
                            color: #ebe9e5;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        .beneos-bi-meta {
                            display: flex;
                            gap: 8px;
                            font-size: 11px;
                            color: #a59d8e;
                            flex-wrap: wrap;
                            align-items: center;
                        }
                        .beneos-bi-badge {
                            font-size: 9px;
                            padding: 2px 5px;
                            border-radius: 3px;
                            font-weight: bold;
                            text-transform: uppercase;
                            letter-spacing: 0.03em;
                        }
                        .beneos-bi-badge.res-hd {
                            background: rgba(143, 170, 198, 0.15);
                            color: #8faac6;
                            border: 1px solid rgba(143, 170, 198, 0.3);
                        }
                        .beneos-bi-badge.res-4k {
                            background: rgba(245, 201, 146, 0.15);
                            color: #f5c992;
                            border: 1px solid rgba(245, 201, 146, 0.3);
                        }
                        .beneos-bi-badge.sub-owned {
                            background: rgba(139, 191, 139, 0.15);
                            color: #8bbf8b;
                            border: 1px solid rgba(139, 191, 139, 0.3);
                        }
                        .beneos-bi-badge.sub-locked {
                            background: rgba(216, 130, 112, 0.15);
                            color: #d88270;
                            border: 1px solid rgba(216, 130, 112, 0.3);
                        }
                        .beneos-bi-item.unowned {
                            opacity: 0.45;
                        }
                        .beneos-bi-empty {
                            text-align: center;
                            padding: 40px;
                            color: #6f6859;
                            font-style: italic;
                        }

                        /* Inline card buttons */
                        .beneos-bi-item-actions {
                            display: flex;
                            gap: 6px;
                            align-items: center;
                            margin-left: auto;
                        }
                        .beneos-bi-card-btn {
                            border-radius: 4px;
                            font-size: 11px;
                            font-weight: bold;
                            padding: 5px 10px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 5px;
                            font-family: inherit;
                            transition: background 0.12s, color 0.12s, border-color 0.12s;
                        }
                        .beneos-bi-card-btn.action-card-download {
                            background: #242019;
                            color: #ebe9e5;
                            border: 1px solid #2e2920;
                        }
                        .beneos-bi-card-btn.action-card-download:hover {
                            background: #2c2721;
                            border-color: #4a4233;
                        }
                        .beneos-bi-card-btn.action-card-install {
                            background: #c89c5e;
                            color: #0c0a09;
                            border: none;
                        }
                        .beneos-bi-card-btn.action-card-install:hover {
                            background: #ffd8a4;
                        }
                        .beneos-bi-card-btn.status-completed {
                            background: rgba(139, 191, 139, 0.25) !important;
                            color: #8bbf8b !important;
                            border: 1px solid rgba(139, 191, 139, 0.4) !important;
                        }
                        .beneos-bi-card-btn.status-completed:hover {
                            background: rgba(139, 191, 139, 0.4) !important;
                        }
                        .beneos-bi-card-btn.status-partial {
                            background: rgba(245, 201, 146, 0.2) !important;
                            color: #f5c992 !important;
                            border: 1px solid rgba(245, 201, 146, 0.4) !important;
                        }
                        .beneos-bi-card-btn.status-partial:hover {
                            background: rgba(245, 201, 146, 0.35) !important;
                        }
 
                        /* Console & Progress Section */
                        .beneos-bi-console-section {
                            background: #0f0e0c;
                            border: 1px solid #2e2920;
                            border-radius: 6px;
                            padding: 12px;
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
                        .beneos-bi-progress-bar-container {
                            height: 6px;
                            background: #242019;
                            border-radius: 3px;
                            overflow: hidden;
                            border: 1px solid #2e2920;
                        }
                        .beneos-bi-progress-bar {
                            width: 0%;
                            height: 100%;
                            background: var(--bc-accent, #c89c5e);
                            transition: width 0.3s ease;
                        }
                        .beneos-bi-console {
                            height: 80px;
                            min-height: 50px;
                            max-height: 400px;
                            resize: none;
                            overflow: auto;
                            font-family: monospace;
                            background: #0c0a09;
                            color: #a59d8e;
                            font-size: 11px;
                            padding: 6px 10px;
                            border-radius: 4px;
                            border: 1px solid #2e2920;
                            display: flex;
                            flex-direction: column;
                            gap: 2px;
                        }
                        .beneos-bi-resize-handle {
                            height: 6px;
                            background: #1e1b18;
                            border-top: 1px solid #2e2920;
                            border-bottom: 1px solid #2e2920;
                            margin: -2px 0;
                            cursor: ns-resize;
                            transition: background 0.12s, border-color 0.12s;
                            flex-shrink: 0;
                            z-index: 10;
                        }
                        .beneos-bi-resize-handle:hover,
                        .beneos-bi-resize-handle.resizing {
                            background: #c89c5e;
                            border-color: #ffd8a4;
                        }
                        .beneos-bi-log-entry { margin: 0; }
                        .beneos-bi-log-entry.success { color: #8bbf8b; }
                        .beneos-bi-log-entry.error { color: #d88270; }
                        .beneos-bi-log-entry.info { color: #8faac6; }

                        /* Footer Area */
                        .beneos-bi-footer {
                            background: #151210;
                            border-top: 1px solid #2e2920;
                            padding: 10px 16px;
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            align-items: center;
                            gap: 16px;
                            flex-shrink: 0;
                        }
                        .beneos-bi-connection-status {
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            justify-self: start;
                        }
                        
                        .beneos-bi-footer-links {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                        }
                        .beneos-bi-footer-link {
                            color: #6f6859;
                            text-decoration: none;
                            font-size: 12px;
                            display: inline-flex;
                            align-items: center;
                            gap: 5px;
                            transition: color 0.12s;
                            cursor: pointer;
                        }
                        .beneos-bi-footer-link:hover {
                            color: #ebe9e5;
                        }
                        .beneos-bi-footer-link.link-patreon:hover {
                            color: #FF424D;
                        }
                        .beneos-bi-footer-link.link-discord:hover {
                            color: #5865F2;
                        }
                        .beneos-bi-footer-link.link-webshop:hover {
                            color: #c89c5e;
                        }
                        .beneos-bi-footer-divider {
                            width: 1px;
                            height: 14px;
                            background: #2e2920;
                        }
                        
                        .beneos-bi-btn-primary {
                            background: #c89c5e;
                            color: #0c0a09;
                            border: none;
                            border-radius: 4px;
                            padding: 6px 14px;
                            font-weight: bold;
                            cursor: pointer;
                            font-size: 12px;
                            font-family: inherit;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-btn-primary:hover {
                            background: #ffd8a4;
                        }
                        .beneos-bi-btn-primary:disabled {
                            background: #242019;
                            color: #6f6859;
                            cursor: not-allowed;
                        }
                        .beneos-bi-btn-guide {
                            background: #242019;
                            color: #a59d8e;
                            border: 1px solid #2e2920;
                            border-radius: 4px;
                            padding: 6px 12px;
                            cursor: pointer;
                            font-size: 12px;
                            font-family: inherit;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            transition: background 0.12s, border-color 0.12s, color 0.12s;
                        }
                        .beneos-bi-btn-guide:hover {
                            background: #2c2721;
                            border-color: #4a4233;
                            color: #ebe9e5;
                        }

                        /* Per-Entity Sweep and Batch Popup Progress Styles */
                        .beneos-bi-item.beneos-bi-item-processing {
                            position: relative;
                            border-left: 3px solid var(--bc-accent, #c89c5e) !important;
                        }
                        .beneos-bi-item.beneos-bi-item-processing::before {
                            content: "";
                            position: absolute;
                            top: 0;
                            bottom: 0;
                            left: 0;
                            width: 0%;
                            background: linear-gradient(
                                90deg,
                                rgba(200, 156, 94, 0.08) 0%,
                                rgba(200, 156, 94, 0.22) 60%,
                                rgba(200, 156, 94, 0.3) 100%
                            );
                            border-radius: 6px;
                            pointer-events: none;
                            z-index: 0;
                            animation: beneos-bi-item-fill 8s ease-out forwards;
                        }
                        .beneos-bi-item.beneos-bi-item-processing > * {
                            position: relative;
                            z-index: 1;
                        }
                        @keyframes beneos-bi-item-fill {
                            0%   { width: 0%; }
                            30%  { width: 45%; }
                            70%  { width: 75%; }
                            90%  { width: 90%; }
                            100% { width: 90%; }
                        }
                        .beneos-bi-item.beneos-bi-item-completed {
                            position: relative;
                            border-left: 3px solid #8bbf8b !important;
                        }
                        .beneos-bi-item.beneos-bi-item-completed::before {
                            content: "";
                            position: absolute;
                            top: 0;
                            bottom: 0;
                            left: 0;
                            width: 100%;
                            background: rgba(139, 191, 139, 0.05);
                            border-radius: 6px;
                            pointer-events: none;
                            z-index: 0;
                        }
                        .beneos-bi-item.beneos-bi-item-completed > * {
                            position: relative;
                            z-index: 1;
                        }
                        .beneos-bi-item.beneos-bi-item-failed {
                            position: relative;
                            border-left: 3px solid #d88270 !important;
                        }
                        .beneos-bi-item.beneos-bi-item-failed::before {
                            content: "";
                            position: absolute;
                            top: 0;
                            bottom: 0;
                            left: 0;
                            width: 100%;
                            background: rgba(216, 130, 112, 0.05);
                            border-radius: 6px;
                            pointer-events: none;
                            z-index: 0;
                        }
                        .beneos-bi-item.beneos-bi-item-failed > * {
                            position: relative;
                            z-index: 1;
                        }
                        .beneos-bi-popup-progress {
                            display: none;
                            align-items: center;
                            gap: 12px;
                            padding: 10px 14px;
                            border: 1px solid #2e2920;
                            border-radius: 6px;
                            background: #1c1814;
                            margin: 4px 0 8px 0;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                            animation: beneos-bi-slide-up 0.25s ease-out;
                            flex-shrink: 0;
                        }
                        .beneos-bi-popup-progress-info {
                            display: flex;
                            flex-direction: column;
                            gap: 2px;
                            min-width: 150px;
                        }
                        .beneos-bi-popup-progress-title {
                            font-size: 10px;
                            font-weight: bold;
                            color: #c89c5e;
                            text-transform: uppercase;
                            letter-spacing: 0.05em;
                        }
                        .beneos-bi-popup-progress-text {
                            font-size: 12px;
                            color: #ebe9e5;
                            font-weight: bold;
                        }
                        .beneos-bi-popup-progress-bar-container {
                            flex: 1;
                            height: 6px;
                            background: #0f0e0c;
                            border-radius: 3px;
                            overflow: hidden;
                            border: 1px solid #2e2920;
                        }
                        .beneos-bi-popup-progress-bar {
                            width: 0%;
                            height: 100%;
                            background: #c89c5e;
                            transition: width 0.2s ease-out;
                        }
                        .beneos-bi-popup-progress-cancel-btn {
                            background: rgba(216, 130, 112, 0.12);
                            border: 1px solid rgba(216, 130, 112, 0.4);
                            color: #d88270;
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 11px;
                            font-weight: bold;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            transition: background 0.12s, color 0.12s, border-color 0.12s;
                            border-image: none;
                        }
                        .beneos-bi-popup-progress-cancel-btn:hover {
                            background: rgba(216, 130, 112, 0.25);
                            color: #ffd8a4;
                            border-color: #d88270;
                        }
                        @keyframes beneos-bi-slide-up {
                            from { transform: translateY(10px); opacity: 0; }
                            to { transform: translateY(0); opacity: 1; }
                        }
                        @keyframes beneos-bi-slide-up {
                            from { transform: translateY(10px); opacity: 0; }
                            to { transform: translateY(0); opacity: 1; }
                        }

                        /* Grid View Layout Styles */
                        .beneos-bi-list.beneos-bi-view-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
                            gap: 12px;
                            padding: 4px;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-item {
                            flex-direction: column;
                            align-items: stretch;
                            gap: 10px;
                            padding: 10px;
                            min-height: 290px;
                            height: auto;
                            justify-content: space-between;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-thumbnail {
                            width: 100%;
                            height: 110px;
                            aspect-ratio: 16 / 9;
                            border-radius: 4px;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-info {
                            flex: none;
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            min-width: 0;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-name {
                            white-space: normal;
                            display: -webkit-box;
                            -webkit-line-clamp: 2;
                            -webkit-box-orient: vertical;
                            overflow: hidden;
                            line-height: 1.2;
                            font-size: 12px;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-meta {
                            gap: 4px;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-item-actions {
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            width: 100%;
                            margin-top: auto;
                            align-self: flex-end;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-card-btn {
                            width: 100%;
                            justify-content: center;
                            font-size: 11px;
                            padding: 6px;
                        }

                        /* Automated Grouping Header Banners */
                        .beneos-bi-group-campaign-header {
                            grid-column: 1 / -1;
                            background: linear-gradient(90deg, rgba(200, 156, 94, 0.15) 0%, rgba(200, 156, 94, 0.03) 100%);
                            border-left: 4px solid #c89c5e;
                            color: #ffd8a4;
                            font-size: 13px;
                            font-weight: bold;
                            padding: 8px 12px;
                            margin: 12px 0 6px 0;
                            border-radius: 0 4px 4px 0;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            text-transform: uppercase;
                            letter-spacing: 0.05em;
                        }
                        .beneos-bi-group-collection-header {
                            grid-column: 1 / -1;
                            border-bottom: 1px solid #2e2920;
                            color: #ebe9e5;
                            font-size: 11px;
                            font-weight: bold;
                            padding: 6px 4px;
                            margin: 8px 0 4px 6px;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            letter-spacing: 0.03em;
                            opacity: 0.85;
                        }
                        .beneos-bi-group-pack-header {
                            grid-column: 1 / -1;
                            color: #a59d8e;
                            font-size: 10px;
                            font-weight: 500;
                            padding: 4px 0;
                            margin: 4px 0 2px 12px;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            opacity: 0.75;
                            border-bottom: 1px dashed rgba(46, 41, 32, 0.5);
                        }
                        .beneos-bi-group-res-header {
                            grid-column: 1 / -1;
                            color: #ffd8a4;
                            font-size: 10px;
                            font-weight: bold;
                            padding: 3px 0;
                            margin: 4px 0 2px 20px;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            opacity: 0.8;
                            letter-spacing: 0.04em;
                            text-transform: uppercase;
                        }
                        .beneos-bi-list.beneos-bi-view-grid .beneos-bi-meta-biomes {
                            display: none !important;
                        }

                        /* Swapped Layout split-button and general toggles */
                        .beneos-bi-view-toggle button {
                            background: transparent;
                            border: none;
                            color: #a59d8e;
                            padding: 4px 8px;
                            font-size: 11px;
                            border-radius: 3px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-view-toggle button:hover {
                            color: #ebe9e5;
                            background: #242019;
                        }
                        .beneos-bi-view-toggle button.active {
                            color: #0c0a09;
                            background: #c89c5e;
                            font-weight: bold;
                        }

                        /* Split Button styled for Footer */
                        .beneos-bi-bulk-split-btn {
                            position: relative;
                            display: inline-flex;
                            vertical-align: middle;
                            border-radius: 4px;
                            overflow: visible;
                            border: 1px solid #2e2920;
                        }
                        .beneos-bi-bulk-main-btn {
                            background: #c89c5e;
                            border: none;
                            color: #0c0a09;
                            padding: 6px 14px;
                            font-weight: bold;
                            font-size: 12px;
                            cursor: pointer;
                            border-radius: 3px 0 0 3px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-bulk-main-btn:hover {
                            background: #ffd8a4;
                        }
                        .beneos-bi-bulk-arrow-btn {
                            background: #1c1814;
                            border: none;
                            border-left: 1px solid #2e2920;
                            color: #ebe9e5;
                            padding: 6px 10px;
                            cursor: pointer;
                            border-radius: 0 3px 3px 0;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: background 0.12s, color 0.12s;
                        }
                        .beneos-bi-bulk-arrow-btn:hover {
                            background: #242019;
                            color: #c89c5e;
                        }
                        .beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-menu {
                            display: none;
                            position: absolute;
                            left: 0 !important;
                            right: auto !important;
                            bottom: 34px;
                            top: auto;
                            background: #151210;
                            border: 1px solid #2e2920;
                            border-radius: 6px;
                            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.6);
                            z-index: 1000;
                            min-width: 260px;
                            padding: 4px 0;
                        }
                        .beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-menu.open {
                            display: block;
                        }
                    </style>

                    <!-- Main Two-Column Layout -->
                    <div class="beneos-bi-main-layout">
                        <!-- Left Sidebar -->
                        <aside class="beneos-bi-sidebar">
                            <div class="beneos-bi-sidebar-section">
                                <div class="beneos-bi-sidebar-title">
                                    <span>GLOBAL TEXT SEARCH</span>
                                    <span class="action-reset-search beneos-bi-reset-search">(RESET)</span>
                                </div>
                                <input type="text" class="beneos-bi-search" placeholder="Filter packs by name..." value="${this.searchQuery}">
                            </div>

                            <div class="beneos-bi-sidebar-section" style="border-top: 1px solid #2e2920; padding-top: 12px;">
                                <div class="beneos-bi-sidebar-title">BIOME</div>
                                <select class="beneos-bi-select filter-biome">
                                    ${biomeOptions}
                                </select>
                            </div>
                            
                            <div class="beneos-bi-sidebar-section" style="border-top: 1px solid #2e2920; padding-top: 12px;">
                                <div class="beneos-bi-sidebar-title">REFINE</div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">BRIGHTNESS</span>
                                        <select class="beneos-bi-select filter-brightness">
                                            ${brightnessOptions}
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">GRID SIZE</span>
                                        <select class="beneos-bi-select filter-grid">
                                            ${gridOptions}
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">TYPE</span>
                                        <select class="beneos-bi-select filter-type">
                                            ${typeOptions}
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">CAMPAIGN</span>
                                        <select class="beneos-bi-select filter-campaign">
                                            ${campaignOptions}
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">RELEASE</span>
                                        <select class="beneos-bi-select filter-release">
                                            ${releaseOptions}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div class="beneos-bi-sidebar-section" style="border-top: 1px solid #2e2920; padding-top: 12px;">
                                <div class="beneos-bi-sidebar-title">Packs Filtering</div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;" title="Filter collections by resolution.">RESOLUTION</span>
                                        <select class="beneos-bi-select filter-resolution" ${!this.isLinked ? 'disabled' : ''}>
                                            <option value="any" ${this.filterResolution === 'any' ? 'selected' : ''}>Any</option>
                                            <option value="4k" ${this.filterResolution === '4k' ? 'selected' : ''}>4K</option>
                                            <option value="hd" ${this.filterResolution === 'hd' ? 'selected' : ''}>HD</option>
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;" title="Filter collections by active Patreon subscription status.">SUBSCRIBER</span>
                                        <select class="beneos-bi-select filter-subscribed" ${!this.isLinked ? 'disabled' : ''}>
                                            <option value="any" ${this.filterSubscribed === 'any' ? 'selected' : ''}>Any</option>
                                            <option value="subscribed" ${this.filterSubscribed === 'subscribed' ? 'selected' : ''}>Subscribe</option>
                                            <option value="unsubscribed" ${this.filterSubscribed === 'unsubscribed' ? 'selected' : ''}>Not Subscribed</option>
                                        </select>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 11px; color: #a59d8e;">SHOW</span>
                                        <select class="beneos-bi-select filter-show">
                                            <option value="any" ${this.filterShow === 'any' ? 'selected' : ''}>Any</option>
                                            <option value="downloaded" ${this.filterShow === 'downloaded' ? 'selected' : ''}>Downloaded</option>
                                            <option value="not_downloaded" ${this.filterShow === 'not_downloaded' ? 'selected' : ''}>Not downloaded</option>
                                            <option value="installed" ${this.filterShow === 'installed' ? 'selected' : ''}>Installed</option>
                                            <option value="not_installed" ${this.filterShow === 'not_installed' ? 'selected' : ''}>Not installed</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="beneos-bi-sidebar-section" style="border-top: 1px solid #2e2920; padding-top: 12px;">
                                <div class="beneos-bi-sidebar-title" style="color: #f5c992;">Options</div>
                                <div class="beneos-bi-checkbox-group">
                                    <label title="If checked, Old VTT folders and scenes matching the package name will be purged before importing.">
                                        <input type="checkbox" class="beneos-bi-check-clean" ${this.optionCleanInstall ? 'checked' : ''} ${!this.isLinked ? 'disabled' : ''}> Clean Install
                                    </label>
                                    <label title="If checked, Old VTT folders will only be purged if folders are empty or files are missing on disk.">
                                        <input type="checkbox" class="beneos-bi-check-autodetect" ${this.optionAutoDetect ? 'checked' : ''} ${!this.isLinked ? 'disabled' : ''}> Auto-Detect
                                    </label>
                                    <label title="If checked, all ScenePacker dialogs, reload prompts, and warnings will be suppressed during the batch.">
                                        <input type="checkbox" class="beneos-bi-check-suppress-scenepacker" ${this.optionSuppressScenePacker ? 'checked' : ''}> Suppress Scene Packer popups
                                    </label>
                                    <label title="If checked, all Beneos Battlemaps welcome journal sheets, tours, and watching popups will be suppressed.">
                                        <input type="checkbox" class="beneos-bi-check-suppress-beneos" ${this.optionSuppressBeneos ? 'checked' : ''}> Suppress Beneos Battlemaps popups
                                    </label>
                                    <label title="If checked, the bottom-left information panel in the footer will be shown.">
                                        <input type="checkbox" class="beneos-bi-check-show-infopanel" ${this.optionShowInfoPanel ? 'checked' : ''}> Show info panel
                                    </label>
                                </div>
                            </div>
                        </aside>
                        
                        <!-- Right main content area -->
                        <div class="beneos-bi-content-area">
                            <!-- Auth check warning banner -->
                            ${!sessionId ? `
                                <div class="beneos-bi-auth-alert">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <div><strong>Beneos Cloud connection missing:</strong> Please enter your Foundry ID in your Beneos Module settings to connect.</div>
                                </div>
                            ` : ''}

                            ${!this.isLinked ? `
                                <div class="beneos-bi-auth-alert patreon-alert" style="display: flex; flex-direction: column; align-items: stretch; gap: 14px; padding: 18px; border-radius: 8px;">
                                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                                        <i class="fab fa-patreon" style="font-size: 2em; color: #ff8f95; margin-top: 2px;"></i>
                                        <div style="display: flex; flex-direction: column; gap: 4px;">
                                            <strong style="font-size: 1.1em; color: #ff8f95;">Moulinette Account Link Required</strong>
                                            <span style="color: #a59d8e; font-size: 0.95em; line-height: 1.4;">
                                                Your Moulinette account is not linked to Patreon or Discord, or you have been logged out. Linking is required to retrieve and download your subscribed Beneos Battlemap collections.
                                            </span>
                                        </div>
                                    </div>
                                    
                                    ${this.isAuthenticating ? `
                                        <div style="background: rgba(200, 156, 94, 0.12); border: 1px solid rgba(200, 156, 94, 0.3); color: #f5c992; padding: 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 0.95em;">
                                            <div style="display: flex; align-items: center; gap: 10px;">
                                                <i class="fas fa-spinner fa-spin" style="color: #c89c5e; font-size: 1.1em;"></i>
                                                <span>Awaiting authorization via ${this.authProvider === 'patreon' ? 'Patreon' : 'Discord'} window...</span>
                                            </div>
                                            <strong style="color: #c89c5e; font-family: monospace; font-size: 1.05em;">${this.timerSecondsLeft}s left</strong>
                                        </div>
                                    ` : `
                                        <div style="display: flex; gap: 12px; margin-top: 4px;">
                                            <button class="beneos-bi-btn-primary action-login-patreon" style="flex: 1; background: #FF424D; color: #0c0a09; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 0.95em; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
                                                <i class="fab fa-patreon" style="font-size: 1.1em;"></i> Link via Patreon
                                            </button>
                                            <button class="beneos-bi-btn-primary action-login-discord" style="flex: 1; background: #5865F2; color: #ebe9e5; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 0.95em; padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
                                                <i class="fab fa-discord" style="font-size: 1.1em;"></i> Link via Discord
                                            </button>
                                        </div>
                                    `}
                                </div>
                            ` : ''}

                            <!-- Resume state banner -->
                            ${this.resumeQueueList && this.resumeQueueList.length > 0 ? `
                                <div class="beneos-bi-auth-alert" style="background: rgba(139, 191, 139, 0.12); border: 1px solid rgba(139, 191, 139, 0.3); color: #8bbf8b; display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 14px; border-radius: 8px;">
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <i class="fas fa-history" style="font-size: 1.5em; color: #8bbf8b;"></i>
                                        <div style="display: flex; flex-direction: column; gap: 2px;">
                                            <strong style="color: #8bbf8b;">Interrupted Session Found</strong>
                                            <span style="color: #a59d8e; font-size: 0.9em; line-height: 1.4;">
                                                An active batch import queue is in progress (imported ${this.importedCount} of ${this.totalToImport} packages). Would you like to resume importing?
                                            </span>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 10px;">
                                        <button class="beneos-bi-btn-primary action-resume-queue" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">
                                            <i class="fas fa-play"></i> Resume Import Queue (${this.resumeQueueList.length} remaining)
                                        </button>
                                        <button class="beneos-bi-btn-secondary action-discard-queue" style="background: rgba(216, 130, 112, 0.1); border-color: rgba(216, 130, 112, 0.4); color: #d88270; padding: 8px 12px; border-radius: 4px; cursor: pointer;">
                                            Discard Session
                                        </button>
                                    </div>
                                </div>
                            ` : ''}

                            <!-- Dynamic Header with Segmented View Toggles and swapped Guide button -->
                            <div class="beneos-bi-content-header" style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 1px solid #2e2920; padding-bottom: 8px; margin-bottom: 4px;">
                                <div class="beneos-bi-matches-count" style="font-size: 13px; color: #a59d8e; font-weight: 500; justify-self: start;">
                                    Showing ${this.viewMode === 'pack' ? this.filteredPackages.length : this.filteredMaps.length} matches
                                </div>
                                <div style="display: flex; gap: 16px; align-items: center; justify-self: center;">
                                    <!-- Left: View Toggle Segment -->
                                    <div class="beneos-bi-view-toggle">
                                        <button class="beneos-bi-view-btn ${this.viewMode === 'pack' ? 'active' : ''}" data-view="pack" title="Map Pack List View">
                                            <i class="fa-solid fa-layer-group"></i> Map Pack
                                        </button>
                                        <button class="beneos-bi-view-btn ${this.viewMode === 'map' ? 'active' : ''}" data-view="map" title="Individual Maps List View">
                                            <i class="fa-solid fa-map"></i> Map
                                        </button>
                                    </div>

                                    <!-- Middle: Group Toggle Segment -->
                                    <div class="beneos-bi-view-toggle">
                                        <button class="beneos-bi-group-btn ${this.groupMode === 'group' ? 'active' : ''}" data-group="group" title="Group collections and campaigns">
                                            <i class="fa-solid fa-folder-open"></i> Group
                                        </button>
                                        <button class="beneos-bi-group-btn ${this.groupMode === 'ungroup' ? 'active' : ''}" data-group="ungroup" title="Flat list view">
                                            <i class="fa-solid fa-list"></i> Ungroup
                                        </button>
                                    </div>

                                    <!-- Right: Layout Toggle Segment -->
                                    <div class="beneos-bi-view-toggle">
                                        <button class="beneos-bi-layout-btn ${this.viewLayout === 'list' ? 'active' : ''}" data-layout="list" title="List View">
                                            <i class="fa-solid fa-table-list"></i> List
                                        </button>
                                        <button class="beneos-bi-layout-btn ${this.viewLayout === 'grid' ? 'active' : ''}" data-layout="grid" title="Grid Card View">
                                            <i class="fa-solid fa-grip"></i> Grid
                                        </button>
                                    </div>
                                </div>
                                <div style="justify-self: end;">
                                    <!-- Swapped Guide Button -->
                                    <button class="beneos-bi-btn-guide action-help" style="height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px;">
                                        <i class="fas fa-question-circle"></i> Guide
                                    </button>
                                </div>
                            </div>

                            <!-- Package Checklist / Maps Grid Container -->
                            <div class="beneos-bi-list-wrapper">
                                <div class="beneos-bi-list">
                                    <!-- Content loaded dynamically via refreshList -->
                                </div>
                            </div>

                            <!-- Batch Progress Popup (Hidden by default, shown during active queue) -->
                            <div class="beneos-bi-popup-progress" style="display: none;">
                                <div class="beneos-bi-popup-progress-info">
                                    <span class="beneos-bi-popup-progress-title"><i class="fas fa-spinner fa-spin"></i> Processing: <span class="active-item-name"></span></span>
                                    <span class="beneos-bi-popup-progress-text">0% (0 / 0 completed)</span>
                                </div>
                                <div class="beneos-bi-popup-progress-bar-container">
                                    <div class="beneos-bi-popup-progress-bar"></div>
                                </div>
                                <button class="beneos-bi-popup-progress-cancel-btn" title="Stop Import Queue">
                                    <i class="fas fa-hand-paper"></i> Cancel Queue
                                </button>
                            </div>

                            <div class="beneos-bi-resize-handle" title="Drag up/down to resize the console panel" style="${this.optionShowInfoPanel ? '' : 'display: none;'}"></div>

                            <!-- Console/Logger and Progress Bar -->
                            <div class="beneos-bi-console-section" style="${this.optionShowInfoPanel ? '' : 'display: none;'}">
                                <div class="beneos-bi-progress-bar-container">
                                    <div class="beneos-bi-progress-bar"></div>
                                </div>
                                <div class="beneos-bi-console">
                                    <p class="beneos-bi-log-entry info">System ready.</p>
                                    <p class="beneos-bi-log-entry info">Apply filters on the left.</p>
                                    <p class="beneos-bi-log-entry info">Download and/or install battlemaps per card or for all via the split action button.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer Area -->
                    <footer class="beneos-bi-footer">
                        <div class="beneos-bi-connection-status" style="justify-self: start;">
                            ${this.isLinked ? `
                                <span class="bc-account-chip bc-chip-success" style="padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; background: rgba(139, 191, 139, 0.15); border: 1px solid rgba(139, 191, 139, 0.3); color: #8bbf8b;">
                                    <i class="fa-solid fa-circle-check"></i> Connected
                                </span>
                            ` : `
                                <span class="bc-account-chip bc-chip-neutral" style="padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; background: rgba(235, 233, 229, 0.1); border: 1px solid rgba(235, 233, 229, 0.2); color: #a59d8e;">
                                    <i class="fa-solid fa-circle-xmark"></i> Disconnected
                                </span>
                            `}
                        </div>
                        
                        <!-- Box-style installation instruction callout (Group 2) -->
                        <div class="beneos-bi-footer-install-box" style="justify-self: center;">
                            <div style="background: #1e1a15; border: 1px solid #4a3f35; border-radius: 6px; padding: 8px 12px; max-width: 320px; text-align: left; line-height: 1.35; font-size: 11px; color: #ebe9e5; box-shadow: 0 2px 6px rgba(0,0,0,0.4); font-family: 'Signika', sans-serif;">
                                Beneos Battlemaps currently install from Moulinette Cloud.
                            </div>
                        </div>
                        
                        <div class="beneos-bi-footer-links" style="justify-self: center;">
                            <a href="https://discord.gg/R2yBH557Wk" target="_blank" class="beneos-bi-footer-link link-discord" title="Join the Beneos Discord server!">
                                <i class="fa-brands fa-discord"></i> Discord
                            </a>
                            <span class="beneos-bi-footer-divider"></span>
                            <a href="https://beneos-battlemaps.com/" target="_blank" class="beneos-bi-footer-link link-webshop" title="Visit the Beneos Webshop!">
                                <i class="fa-solid fa-cart-shopping"></i> Webshop
                            </a>
                            <span class="beneos-bi-footer-divider"></span>
                            <a href="https://www.patreon.com/beneosbattlemaps" target="_blank" class="beneos-bi-footer-link link-patreon" title="Support Beneos Battlemaps on Patreon!">
                                <i class="fa-brands fa-patreon"></i> Patreon
                            </a>
                        </div>
                        
                        <div style="display: flex; gap: 8px; align-items: center; position: relative; justify-self: end;">
                            ${!this.isLinked ? `
                                <button class="beneos-bi-btn-primary action-retry" style="background: #c89c5e;">
                                    <i class="fas fa-sync-alt"></i> Reconnect
                                </button>
                            ` : `
                                <div class="beneos-bi-bulk-split-btn">
                                    <button class="beneos-bi-bulk-main-btn" data-action="bulk-both" title="Execute bulk action on all visible items">
                                        <i class="fa-solid fa-download"></i> Download & Install
                                    </button>
                                    <button class="beneos-bi-bulk-arrow-btn" title="Configure bulk action">
                                        <i class="fa-solid fa-chevron-down"></i>
                                    </button>
                                    <div class="beneos-bi-bulk-dropdown-menu">
                                        <button class="beneos-bi-bulk-dropdown-item" data-action="bulk-both" data-label="Download & Install" data-icon="fa-download">
                                            <i class="fa-solid fa-download"></i> Download & Install
                                        </button>
                                        <button class="beneos-bi-bulk-dropdown-item" data-action="bulk-download" data-label="Download Only" data-icon="fa-cloud-arrow-down">
                                            <i class="fa-solid fa-cloud-arrow-down"></i> Download Only
                                        </button>
                                        <button class="beneos-bi-bulk-dropdown-item" data-action="bulk-install" data-label="Install Only" data-icon="fa-cube">
                                            <i class="fa-solid fa-cube"></i> Install Only
                                        </button>
                                        <button class="beneos-bi-bulk-dropdown-item" data-action="bulk-uninstall" data-label="Uninstall All" data-icon="fa-trash">
                                            <i class="fa-solid fa-trash"></i> Uninstall All
                                        </button>
                                    </div>
                                </div>
                            `}
                        </div>
                    </footer>
                </div>
            `);

            // Initial population of the lists
            this.refreshList(html);

            return html;
        }

        getThumbnailForPackage(pkg) {
            if (!pkg || !pkg.id) return null;
            const cacheKey = pkg.id.toString();
            if (this.thumbnailCache && this.thumbnailCache.has(cacheKey)) {
                return this.thumbnailCache.get(cacheKey);
            }

            if (!game.beneos?.databaseHolder) return null;
            const bmaps = game.beneos.databaseHolder.getAll("bmap");
            const nameLower = pkg.name.toLowerCase();
            const cleanPkg = nameLower.replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");

            for (const [key, bmap] of Object.entries(bmaps)) {
                const props = bmap.properties || {};
                const downloadPack = props.download_pack;
                let isMatch = false;

                // 1. Check if download_pack matches
                if (downloadPack) {
                    const cleanPack = downloadPack.toLowerCase().replace(/\s*-\s*\d+$/, "").replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanPack) || cleanPack.includes(cleanPkg)) {
                        isMatch = true;
                    }
                }
                // 2. Check if packageId matches
                if (!isMatch && (bmap.packageId === pkg.id)) {
                    isMatch = true;
                }
                // 3. Fallback: check if the map name is part of the package name
                if (!isMatch) {
                    const mapNameLower = bmap.name.toLowerCase();
                    const cleanMapName = mapNameLower.replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanMapName) || cleanMapName.includes(cleanPkg)) {
                        isMatch = true;
                    }
                }

                if (isMatch) {
                    const thumb = props.thumbnail;
                    if (thumb) {
                        const resultUrl = `https://www.beneos-database.com/data/battlemaps/thumbnails/${thumb}`;
                        if (this.thumbnailCache) this.thumbnailCache.set(cacheKey, resultUrl);
                        return resultUrl;
                    }
                }
            }
            if (this.thumbnailCache) this.thumbnailCache.set(cacheKey, null);
            return null;
        }

        getMetadataForPackage(pkg) {
            if (!pkg || !pkg.id) return { campaigns: "None", biomes: "None" };
            const cacheKey = pkg.id.toString();
            if (this.metadataCache && this.metadataCache.has(cacheKey)) {
                return this.metadataCache.get(cacheKey);
            }

            const bmaps = game.beneos?.databaseHolder?.getAll?.("bmap") || {};
            const campaigns = new Set();
            const biomes = new Set();
            const nameLower = pkg.name.toLowerCase();
            const cleanPkg = nameLower.replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");

            for (const [key, bmap] of Object.entries(bmaps)) {
                const props = bmap.properties || {};
                const downloadPack = props.download_pack;
                let isMatch = false;

                if (downloadPack) {
                    const cleanPack = downloadPack.toLowerCase().replace(/\s*-\s*\d+$/, "").replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanPack) || cleanPack.includes(cleanPkg)) isMatch = true;
                }
                if (!isMatch && (bmap.packageId === pkg.id)) {
                    isMatch = true;
                }
                if (!isMatch) {
                    const cleanMapName = bmap.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanMapName) || cleanMapName.includes(cleanPkg)) isMatch = true;
                }

                if (isMatch) {
                    if (props.adventure) {
                        if (Array.isArray(props.adventure)) {
                            props.adventure.forEach(c => {
                                if (c && c.toLowerCase() !== "none") campaigns.add(c);
                            });
                        } else if (props.adventure.toLowerCase() !== "none") {
                            campaigns.add(props.adventure);
                        }
                    }
                    if (props.biom) {
                        if (Array.isArray(props.biom)) {
                            props.biom.forEach(b => biomes.add(b));
                        } else {
                            biomes.add(props.biom);
                        }
                    }
                }
            }

            const result = {
                campaigns: Array.from(campaigns).sort().join(", ") || "None",
                biomes: Array.from(biomes).sort().map(b => this.formatFilterLabel(b)).join(", ") || "None"
            };
            if (this.metadataCache) this.metadataCache.set(cacheKey, result);
            return result;
        }

        cleanSessionKey(key) {
            if (!key) return "";
            return key.toString().toLowerCase().replace(/\s+/g, " ").trim();
        }

        getCoreName(name) {
            if (!name) return "";
            return name.toLowerCase()
                .replace(/\s*(4k|hd|uhd|ultra hd|high def|1080p|1080|2k)\b.*$/i, "")
                .replace(/^(cos|dda|dnd|d&d|ch|chapter)\b\s*(\d+\b)?\s*/i, "")
                .replace(/\s*-\s*\d+.*$/i, "")
                .replace(/[^a-z0-9]/g, "");
        }

        async scanLocalDownloadedPacks() {
            this.localDownloadedFolders = { hd: new Set(), "4k": new Set() };
            try {
                // 1. Scan the top-level folders inside moulinette/adventures
                const topLevel = await FilePicker.browse("data", "moulinette/adventures");
                if (topLevel && topLevel.dirs) {
                    for (const advDir of topLevel.dirs) {
                        // Scan for 4K packs inside this adventure folder
                        try {
                            const res4k = await FilePicker.browse("data", `${advDir}/beneos_assets/beneos_battlemaps/4k`);
                            if (res4k && res4k.dirs) {
                                for (const dir of res4k.dirs) {
                                    const parts = dir.split("/");
                                    const folderName = parts[parts.length - 1];
                                    const match = folderName.match(/^(\d+)_/);
                                    if (match) {
                                        this.localDownloadedFolders["4k"].add(match[1].toString());
                                    }
                                }
                            }
                        } catch (e) {
                            // Suppress warning if this folder doesn't contain a 4K subfolder
                        }

                        // Scan for HD packs inside this adventure folder
                        try {
                            const resHD = await FilePicker.browse("data", `${advDir}/beneos_assets/beneos_battlemaps/hd`);
                            if (resHD && resHD.dirs) {
                                for (const dir of resHD.dirs) {
                                    const parts = dir.split("/");
                                    const folderName = parts[parts.length - 1];
                                    const match = folderName.match(/^(\d+)_/);
                                    if (match) {
                                        this.localDownloadedFolders["hd"].add(match[1].toString());
                                    }
                                }
                            }
                        } catch (e) {
                            // Suppress warning if this folder doesn't contain an HD subfolder
                        }
                    }
                }
            } catch (e) {
                console.warn("Beneos Batch Importer | Local adventures folder scan skipped or failed:", e);
            }
        }

        getConstituentMapNames(pkgId, pkgName) {
            const cacheKey = `${pkgId || ""}_${pkgName || ""}`;
            if (this.constituentMapsCache && this.constituentMapsCache.has(cacheKey)) {
                return this.constituentMapsCache.get(cacheKey);
            }

            if (!game.beneos?.databaseHolder) return [];
            const bmaps = game.beneos.databaseHolder.getAll("bmap") || {};
            const cleanPkg = pkgName ? pkgName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "") : "";
            
            const names = [];
            for (const [key, data] of Object.entries(bmaps)) {
                let isMatch = false;
                const props = data.properties || {};
                const downloadPack = props.download_pack;
                
                if (downloadPack && cleanPkg) {
                    const cleanPack = downloadPack.toLowerCase().replace(/\s*-\s*\d+$/, "").replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanPack) || cleanPack.includes(cleanPkg)) {
                        isMatch = true;
                    }
                }
                if (!isMatch && pkgId && (data.packageId === pkgId)) {
                    isMatch = true;
                }
                if (!isMatch && cleanPkg) {
                    const mapNameLower = data.name.toLowerCase();
                    const cleanMapName = mapNameLower.replace(/[^a-z0-9]/g, "");
                    if (cleanPkg.includes(cleanMapName) || cleanMapName.includes(cleanPkg)) {
                        isMatch = true;
                    }
                }
                
                if (isMatch) {
                    names.push(data.name);
                }
            }
            if (this.constituentMapsCache) this.constituentMapsCache.set(cacheKey, names);
            return names;
        }

        getCampaignName(pkg) {
            if (!pkg || !pkg.id) return "Independent Releases";
            const cacheKey = pkg.id.toString();
            if (this.campaignNameCache && this.campaignNameCache.has(cacheKey)) {
                return this.campaignNameCache.get(cacheKey);
            }

            const meta = this.getMetadataForPackage(pkg);
            let camp = meta.campaigns;
            if (!camp || camp === "None" || camp === "Unknown") {
                const nameLower = pkg.name.toLowerCase();
                let res = "Independent Releases";
                if (nameLower.startsWith("cos") || nameLower.includes("ravenloft") || nameLower.includes("strahd")) res = "Curse Of Strahd";
                else if (nameLower.startsWith("dda") || nameLower.includes("defiance in phlan")) res = "Defiance In Phlan";
                else if (nameLower.startsWith("dnd") || nameLower.includes("d&d")) res = "Dungeons & Dragons";
                if (this.campaignNameCache) this.campaignNameCache.set(cacheKey, res);
                return res;
            }
            if (camp.includes(",")) {
                camp = camp.split(",")[0].trim();
            }
            const res = camp.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            if (this.campaignNameCache) this.campaignNameCache.set(cacheKey, res);
            return res;
        }

        getCollectionName(pkgName) {
            if (!pkgName) return "General Releases";
            const cacheKey = pkgName.toString();
            if (this.collectionNameCache && this.collectionNameCache.has(cacheKey)) {
                return this.collectionNameCache.get(cacheKey);
            }

            let name = pkgName;
            
            name = name.replace(/\s*(4k|hd|uhd|ultra hd|high def|1080p|1080|2k)\b.*$/i, "");
            name = name.replace(/^(cos|dda|dnd|d&d)\b\s*(\d+\b)?\s*/i, "");
            name = name.replace(/\s*-\s*\d+.*$/i, "");
            name = name.replace(/\s*(B\d+|G\d+|\d+F|[A-Z]\d+|\d+F-\d+F|Floor\s+\d+|Basement|Cellar|Attic|Roof|Ground\s+Floor|Underground)\b.*$/i, "");
            name = name.replace(/\s*(bright|dark|old version|old_version|day|night|rain|snow|grid|nogrid|no grid|winter|summer|autumn|spring)\b.*$/i, "");
            
            name = name.trim().replace(/\s+/g, " ");
            if (!name) {
                if (this.collectionNameCache) this.collectionNameCache.set(cacheKey, "General Releases");
                return "General Releases";
            }
            const res = name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            if (this.collectionNameCache) this.collectionNameCache.set(cacheKey, res);
            return res;
        }

        triggerInteractiveFilter(html = null, callback) {
            const activeHtml = (html && html.length) ? html : $(this.element);
            if (activeHtml && activeHtml.length) {
                const list = activeHtml.find('.beneos-bi-list');
                if (list.length) {
                    list.empty().append(`
                        <div class="beneos-bi-empty" style="padding: 60px 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: 200px;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2.5em; color: #c89c5e;"></i>
                            <div style="font-size: 14px; font-weight: bold; color: #ebe9e5;">Processing...</div>
                        </div>
                    `);
                }
            }
            setTimeout(() => {
                callback();
            }, 10);
        }

        buildPackCardHTML(pkg) {
            const is4K = pkg.name.toLowerCase().includes("4k") || pkg.name.toLowerCase().includes("uhd") || pkg.name.toLowerCase().includes("ultra hd");
            const resClass = is4K ? 'res-4k' : 'res-hd';
            const resLabel = is4K ? '4K' : 'HD';
            const premiumThumb = this.getThumbnailForPackage(pkg);
            const serverUrl = 'https://beneos.cloud';
            const sessionId = game.settings.get('beneos-module', 'beneos-cloud-foundry-id') || "";
            const coverUrl = premiumThumb || (pkg.cover_image ? `${serverUrl}/scenepacker-files.php?package=${pkg.id}&file=${pkg.cover_image}&s=${sessionId}` : 'icons/svg/clockwork.svg');

            const ownedClass = pkg.isOwned ? 'owned' : 'unowned';
            const badgeClass = pkg.isOwned ? 'sub-owned' : 'sub-locked';
            const badgeLabel = pkg.isOwned ? 'Subscribed' : 'Locked';

            const meta = this.getMetadataForPackage(pkg);
            const isDownloaded = this.checkDownloadStatus(pkg.id, pkg.name);
            const status = this.checkInstallStatus(pkg.name, pkg.id);
            const isInstalled = status === "installed";
            const isPartial = status === "partial";

            const downloadBtnClass = isDownloaded ? 'status-completed' : '';
            const downloadBtnText = isDownloaded ? '<i class="fa-solid fa-circle-check"></i> Downloaded' : '<i class="fa-solid fa-cloud-arrow-down"></i> Download';

            const installBtnClass = isInstalled ? 'status-completed' : (isPartial ? 'status-partial' : '');
            const installBtnText = isInstalled ? '<i class="fa-solid fa-circle-check"></i> Installed' : (isPartial ? '<i class="fa-solid fa-triangle-exclamation"></i> Partial' : '<i class="fa-solid fa-cube"></i> Install');

            const isProcessing = this.currentlyImportingId?.toString() === pkg.id?.toString();
            const isCompleted = this.completedImportingIds?.has(pkg.id?.toString());
            const isFailed = this.failedImportingIds?.has(pkg.id?.toString());
            const progressClass = isProcessing ? 'beneos-bi-item-processing' : (isCompleted ? 'beneos-bi-item-completed' : (isFailed ? 'beneos-bi-item-failed' : ''));

            let inlineStatusBadge = "";
            if (isInstalled) {
                inlineStatusBadge = `<span class="beneos-bi-badge sub-owned" style="background: rgba(139, 191, 139, 0.15); color: #8bbf8b; border: 1px solid rgba(139, 191, 139, 0.3);"><i class="fa-solid fa-circle-check"></i> Installed</span>`;
            } else if (isPartial) {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(245, 201, 146, 0.15); color: #f5c992; border: 1px solid rgba(245, 201, 146, 0.3);"><i class="fa-solid fa-triangle-exclamation"></i> Partial</span>`;
            } else if (isDownloaded) {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(143, 170, 198, 0.15); color: #8faac6; border: 1px solid rgba(143, 170, 198, 0.3);"><i class="fa-solid fa-cloud"></i> Downloaded</span>`;
            } else {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(235, 233, 229, 0.08); color: #a59d8e; border: 1px solid rgba(235, 233, 229, 0.15);"><i class="fa-solid fa-times-circle"></i> Not Installed</span>`;
            }

            return `
                 <div class="beneos-bi-item ${ownedClass} ${progressClass}" data-package-id="${pkg.id}">
                     <img class="beneos-bi-thumbnail" src="${coverUrl}" alt="${pkg.name}" onerror="this.removeAttribute('onerror'); this.src='icons/svg/clockwork.svg';">
                     <div class="beneos-bi-info">
                         <div class="beneos-bi-name" title="${pkg.name}">${pkg.name}</div>
                         <div class="beneos-bi-meta">
                             <span class="beneos-bi-badge ${resClass}">${resLabel}</span>
                             <span class="beneos-bi-badge ${badgeClass}">${badgeLabel}</span>
                             <span><strong>Campaign:</strong> ${meta.campaigns}</span>
                         </div>
                         <div class="beneos-bi-meta beneos-bi-meta-biomes" style="margin-top: 2px;">
                             <span><strong>Biomes:</strong> ${meta.biomes}</span>
                         </div>
                     </div>
                     ${pkg.isOwned ? `
                         <div class="beneos-bi-item-actions">
                             <button class="beneos-bi-card-btn action-card-download ${downloadBtnClass}" data-package-id="${pkg.id}" title="Download pack assets to local disk">
                                 ${downloadBtnText}
                             </button>
                             <button class="beneos-bi-card-btn action-card-install ${installBtnClass}" data-package-id="${pkg.id}" title="Install scenes in world">
                                 ${installBtnText}
                             </button>
                         </div>
                     ` : ''}
                 </div>
             `;
        }

        buildMapCardHTML(map) {
            const is4K = map.is4K;
            const resClass = is4K ? 'res-4k' : 'res-hd';
            const resLabel = is4K ? '4K' : 'HD';
            const thumb = map.properties?.thumbnail;
            const coverUrl = thumb ? `https://www.beneos-database.com/data/battlemaps/thumbnails/${thumb}` : 'icons/svg/clockwork.svg';
            const campaign = map.properties?.adventure || "None";
            const bioms = Array.isArray(map.properties?.biom) ? map.properties.biom.map(this.formatFilterLabel).join(', ') : (this.formatFilterLabel(map.properties?.biom) || "None");

            const pkgName = this.packages.find(p => p.id?.toString() === map.packageId?.toString())?.name || map.properties?.download_pack;
            const isDownloaded = this.checkDownloadStatus(map.packageId, pkgName);
            const status = this.checkInstallStatus(pkgName, map.packageId);
            const isInstalled = status === "installed";
            const isPartial = status === "partial";

            const downloadBtnClass = isDownloaded ? 'status-completed' : '';
            const downloadBtnText = isDownloaded ? '<i class="fa-solid fa-circle-check"></i> Downloaded' : '<i class="fa-solid fa-cloud-arrow-down"></i> Download';

            const installBtnClass = isInstalled ? 'status-completed' : (isPartial ? 'status-partial' : '');
            const installBtnText = isInstalled ? '<i class="fa-solid fa-circle-check"></i> Installed' : (isPartial ? '<i class="fa-solid fa-triangle-exclamation"></i> Partial' : '<i class="fa-solid fa-cube"></i> Install');

            const isProcessing = this.currentlyImportingId?.toString() === map.packageId?.toString();
            const isCompleted = this.completedImportingIds?.has(map.packageId?.toString());
            const isFailed = this.failedImportingIds?.has(map.packageId?.toString());
            const progressClass = isProcessing ? 'beneos-bi-item-processing' : (isCompleted ? 'beneos-bi-item-completed' : (isFailed ? 'beneos-bi-item-failed' : ''));

            let inlineStatusBadge = "";
            if (isInstalled) {
                inlineStatusBadge = `<span class="beneos-bi-badge sub-owned" style="background: rgba(139, 191, 139, 0.15); color: #8bbf8b; border: 1px solid rgba(139, 191, 139, 0.3);"><i class="fa-solid fa-circle-check"></i> Installed</span>`;
            } else if (isPartial) {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(245, 201, 146, 0.15); color: #f5c992; border: 1px solid rgba(245, 201, 146, 0.3);"><i class="fa-solid fa-triangle-exclamation"></i> Partial</span>`;
            } else if (isDownloaded) {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(143, 170, 198, 0.15); color: #8faac6; border: 1px solid rgba(143, 170, 198, 0.3);"><i class="fa-solid fa-cloud"></i> Downloaded</span>`;
            } else {
                inlineStatusBadge = `<span class="beneos-bi-badge" style="background: rgba(235, 233, 229, 0.08); color: #a59d8e; border: 1px solid rgba(235, 233, 229, 0.15);"><i class="fa-solid fa-times-circle"></i> Not Installed</span>`;
            }

            return `
                 <div class="beneos-bi-item ${progressClass}" data-key="${map.key}" data-package-id="${map.packageId}">
                     <img class="beneos-bi-thumbnail" src="${coverUrl}" alt="${map.name}" onerror="this.removeAttribute('onerror'); this.src='icons/svg/clockwork.svg';">
                     <div class="beneos-bi-info">
                         <div class="beneos-bi-name" title="${map.name}">${map.name}</div>
                         <div class="beneos-bi-meta">
                             <span class="beneos-bi-badge ${resClass}">${resLabel}</span>
                             <span><strong>Map Pack:</strong> ${pkgName || 'None'}</span>
                             <span><strong>Campaign:</strong> ${campaign}</span>
                         </div>
                         <div class="beneos-bi-meta beneos-bi-meta-biomes" style="margin-top: 2px;">
                             <span><strong>Biomes:</strong> ${bioms}</span>
                         </div>
                     </div>
                     <div class="beneos-bi-item-actions">
                         <button class="beneos-bi-card-btn action-card-download ${downloadBtnClass}" data-key="${map.key}" data-package-id="${map.packageId}" data-package-name="${pkgName}" title="Download pack assets to local disk">
                             ${downloadBtnText}
                         </button>
                         <button class="beneos-bi-card-btn action-card-install ${installBtnClass}" data-key="${map.key}" data-package-id="${map.packageId}" data-package-name="${pkgName}" title="Install scene in world">
                             ${installBtnText}
                         </button>
                     </div>
                 </div>
             `;
        }

        checkInstallStatus(pkgName, pkgId = null) {
            if (!pkgName) return "none";
            
            const cacheKey = `${pkgName}_${pkgId || ""}`;
            if (this.installStatusCache && this.installStatusCache.has(cacheKey)) {
                return this.installStatusCache.get(cacheKey);
            }

            if (this.installedPackagesSession?.has(this.cleanSessionKey(pkgName))) {
                this.installStatusCache?.set(cacheKey, "installed");
                return "installed";
            }
            
            const targets = new Set();
            const coreTargets = new Set();
            
            const cleanTarget = pkgName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
            targets.add(cleanTarget);
            
            const coreTarget = this.getCoreName(pkgName);
            if (coreTarget.length > 3) {
                coreTargets.add(coreTarget);
            }
            
            const constituentNames = this.getConstituentMapNames(pkgId, pkgName);
            for (const mapName of constituentNames) {
                const cleanMapName = mapName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                if (cleanMapName.length > 4) {
                    targets.add(cleanMapName);
                }
                const coreMap = this.getCoreName(mapName);
                if (coreMap.length > 3) {
                    coreTargets.add(coreMap);
                }
            }
            
            let hasInstalled = false;
            let hasPartial = false;
            const is4KTarget = pkgName.toLowerCase().includes("4k") || pkgName.toLowerCase().includes("uhd") || pkgName.toLowerCase().includes("ultra hd");

            // 1. Direct Scene Check
            const matchingScenes = game.scenes.filter(s => {
                const cleanScene = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                const coreScene = this.getCoreName(s.name);
                
                for (const t of targets) {
                    if (cleanScene.includes(t) || t.includes(cleanScene)) return true;
                }
                for (const ct of coreTargets) {
                    if (coreScene.includes(ct) || ct.includes(coreScene)) return true;
                }
                
                const sourceId = s.getFlag('core', 'sourceId') || s._stats?.compendiumSource || s.getFlag('scene-packer', 'sourceId') || "";
                if (sourceId) {
                    const cleanSource = sourceId.toLowerCase().replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanSource.includes(t)) return true;
                    }
                    for (const ct of coreTargets) {
                        if (cleanSource.includes(ct)) return true;
                    }
                    if (pkgId && cleanSource.includes(pkgId.toString())) {
                        return true;
                    }
                }
                return false;
            });

            if (matchingScenes.length > 0) {
                for (const scene of matchingScenes) {
                    const rawBg = scene.img || scene._source?.background?.src || "";
                    const bgPath = typeof rawBg === "string" ? rawBg.toLowerCase() : String(rawBg || "").toLowerCase();
                    const isBg4K = bgPath.includes("4k") || bgPath.includes("uhd") || bgPath.includes("ultra hd") || bgPath.includes("ultra_hd");
                    if (is4KTarget === isBg4K) {
                        hasInstalled = true;
                    } else {
                        hasPartial = true;
                    }
                }
            }

            // 2. Direct Journal Check
            const matchingJournals = game.journal.filter(j => {
                const cleanJournal = j.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                const coreJournal = this.getCoreName(j.name);
                
                for (const t of targets) {
                    if (cleanJournal.includes(t) || t.includes(cleanJournal)) return true;
                }
                for (const ct of coreTargets) {
                    if (coreJournal.includes(ct) || ct.includes(coreJournal)) return true;
                }
                
                const sourceId = j.getFlag('core', 'sourceId') || j._stats?.compendiumSource || j.getFlag('scene-packer', 'sourceId') || "";
                if (sourceId) {
                    const cleanSource = sourceId.toLowerCase().replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanSource.includes(t)) return true;
                    }
                    for (const ct of coreTargets) {
                        if (cleanSource.includes(ct)) return true;
                    }
                    if (pkgId && cleanSource.includes(pkgId.toString())) {
                        return true;
                    }
                }
                return false;
            });

            if (matchingJournals.length > 0) {
                for (const journal of matchingJournals) {
                    let foundPath = "";
                    if (journal.pages) {
                        const page = journal.pages.find(p => {
                            const src = p.src || p.image?.src || p.system?.src || p.text?.content || "";
                            return typeof src === "string" && src.toLowerCase().includes("moulinette");
                        });
                        if (page) {
                            const rawSrc = page.src || page.image?.src || page.system?.src || page.text?.content || "";
                            foundPath = typeof rawSrc === "string" ? rawSrc.toLowerCase() : String(rawSrc || "").toLowerCase();
                        }
                    }
                    if (foundPath) {
                        const isPath4K = foundPath.includes("4k") || foundPath.includes("uhd") || foundPath.includes("ultra hd") || foundPath.includes("ultra_hd");
                        if (is4KTarget === isPath4K) {
                            hasInstalled = true;
                        } else {
                            hasPartial = true;
                        }
                    } else {
                        hasInstalled = true;
                    }
                }
            }

            // 3. Folder Check fallback
            const folders = game.folders.filter(f => {
                if (f.type !== "Scene" && f.type !== "JournalEntry") return false;
                const cleanFolder = f.name.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                const coreFolder = this.getCoreName(f.name);
                
                for (const t of targets) {
                    if (cleanFolder === t || cleanFolder.includes(t) || t.includes(cleanFolder)) return true;
                }
                for (const ct of coreTargets) {
                    if (coreFolder === ct || coreFolder.includes(ct) || ct.includes(coreFolder)) return true;
                }
                return false;
            });

            if (folders.length > 0) {
                for (const folder of folders) {
                    if (folder.contents.length > 0) {
                        let resMatch = true;
                        if (folder.type === "Scene") {
                            const sceneWithBg = folder.contents.find(s => s.img || s._source?.background?.src);
                            if (sceneWithBg) {
                                const rawBg = sceneWithBg.img || sceneWithBg._source?.background?.src || "";
                                const bgPath = typeof rawBg === "string" ? rawBg.toLowerCase() : String(rawBg || "").toLowerCase();
                                const isBg4K = bgPath.includes("4k") || bgPath.includes("uhd") || bgPath.includes("ultra hd") || bgPath.includes("ultra_hd");
                                if (is4KTarget !== isBg4K) resMatch = false;
                            }
                        } else if (folder.type === "JournalEntry") {
                            let foundPath = "";
                            for (const journal of folder.contents) {
                                if (journal.pages) {
                                    const page = journal.pages.find(p => {
                                        const src = p.src || p.image?.src || p.system?.src || p.text?.content || "";
                                        return typeof src === "string" && src.toLowerCase().includes("moulinette");
                                    });
                                    if (page) {
                                        const rawSrc = page.src || page.image?.src || page.system?.src || page.text?.content || "";
                                        foundPath = typeof rawSrc === "string" ? rawSrc.toLowerCase() : String(rawSrc || "").toLowerCase();
                                        break;
                                    }
                                }
                            }
                            if (foundPath) {
                                const isPath4K = foundPath.includes("4k") || foundPath.includes("uhd") || foundPath.includes("ultra hd") || foundPath.includes("ultra_hd");
                                if (is4KTarget !== isPath4K) resMatch = false;
                            }
                        }
                        if (resMatch) {
                            hasInstalled = true;
                        } else {
                            hasPartial = true;
                        }
                    } else {
                        hasPartial = true;
                    }
                }
            }

            let finalStatus = "none";
            if (hasInstalled) {
                finalStatus = "installed";
            } else if (folders.length > 0 || matchingScenes.length > 0 || matchingJournals.length > 0 || hasPartial) {
                finalStatus = "partial";
            }

            this.installStatusCache?.set(cacheKey, finalStatus);
            return finalStatus;
        }

        checkDownloadStatus(pkgId, pkgName) {
            if (!pkgName) return false;
            
            const cacheKey = `${pkgId || ""}_${pkgName}`;
            if (this.downloadStatusCache && this.downloadStatusCache.has(cacheKey)) {
                return this.downloadStatusCache.get(cacheKey);
            }

            if (this.downloadedPackagesSession?.has(this.cleanSessionKey(pkgId)) || 
                this.downloadedPackagesSession?.has(this.cleanSessionKey(pkgName))) {
                this.downloadStatusCache?.set(cacheKey, true);
                return true;
            }

            let isDownloaded = false;

            // 1. Check scanned filesystem cache
            if (this.localDownloadedFolders) {
                const is4KTarget = pkgName.toLowerCase().includes("4k") || pkgName.toLowerCase().includes("uhd") || pkgName.toLowerCase().includes("ultra hd");
                const resKey = is4KTarget ? "4k" : "hd";
                if (pkgId && this.localDownloadedFolders[resKey]?.has(pkgId.toString())) {
                    isDownloaded = true;
                }
            }

            // 2. Fallback to loose Moulinette sources string match
            if (!isDownloaded && game.moulinette?.sources) {
                const is4KTarget = pkgName.toLowerCase().includes("4k") || pkgName.toLowerCase().includes("uhd") || pkgName.toLowerCase().includes("ultra hd");
                
                const localPack = game.moulinette.sources.find(src => {
                    const srcNameLower = (src.name || "").toLowerCase();
                    const cleanPkgBase = pkgName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                    const cleanSrcBase = srcNameLower.replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                    if (cleanPkgBase !== cleanSrcBase && !cleanPkgBase.includes(cleanSrcBase) && !cleanSrcBase.includes(cleanPkgBase)) {
                        return false;
                    }
                    
                    const isSrc4K = srcNameLower.includes("4k") || srcNameLower.includes("uhd") || srcNameLower.includes("ultra hd");
                    return is4KTarget === isSrc4K;
                });
                if (localPack) isDownloaded = true;
            }

            if (!isDownloaded && this.checkInstallStatus(pkgName, pkgId) === "installed") {
                isDownloaded = true;
            }

            this.downloadStatusCache?.set(cacheKey, isDownloaded);
            return isDownloaded;
        }

        /**
         * Set up interactives and listeners using event delegation
         */
        _setupListeners(html) {
            // Resizable console horizontal splitter handle
            html.on('mousedown', '.beneos-bi-resize-handle', (e) => {
                e.preventDefault();
                const handle = $(e.currentTarget);
                handle.addClass('resizing');
                const consoleEl = html.find('.beneos-bi-console');
                const startY = e.clientY;
                const startHeight = consoleEl.height();

                const onMouseMove = (moveEvent) => {
                    const deltaY = startY - moveEvent.clientY;
                    const newHeight = Math.max(50, Math.min(450, startHeight + deltaY));
                    consoleEl.height(newHeight);
                };

                const onMouseUp = () => {
                    handle.removeClass('resizing');
                    $(document).off('mousemove', onMouseMove);
                    $(document).off('mouseup', onMouseUp);
                };

                $(document).on('mousemove', onMouseMove);
                $(document).on('mouseup', onMouseUp);
            });

            // View Mode click handlers (Map Pack / Map)
            html.on('click', '.beneos-bi-view-btn', (e) => {
                const view = $(e.currentTarget).attr('data-view');
                if (this.viewMode === view) return;
                this.viewMode = view;
                html.find('.beneos-bi-view-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });

            // Group Mode click handlers (Group / Ungroup)
            html.on('click', '.beneos-bi-group-btn', (e) => {
                const group = $(e.currentTarget).attr('data-group');
                if (this.groupMode === group) return;
                this.groupMode = group;
                html.find('.beneos-bi-group-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                
                this.triggerInteractiveFilter(html, () => {
                    this.refreshList(html);
                });
            });

            // Layout Mode click handlers (List / Grid)
            html.on('click', '.beneos-bi-layout-btn', (e) => {
                const layout = $(e.currentTarget).attr('data-layout');
                if (this.viewLayout === layout) return;
                this.viewLayout = layout;
                html.find('.beneos-bi-layout-btn').removeClass('active');
                $(e.currentTarget).addClass('active');
                
                this.triggerInteractiveFilter(html, () => {
                    this.refreshList(html);
                });
            });

            // Split Bulk Button Arrow click to open dropdown
            html.on('click', '.beneos-bi-bulk-arrow-btn', (e) => {
                e.stopPropagation();
                html.find('.beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-menu').toggleClass('open');
            });

            // Close when clicking elsewhere
            $(document).on('click', () => {
                html.find('.beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-menu').removeClass('open');
            });

            // Split Button dropdown item select
            html.on('click', '.beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-item', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const item = $(e.currentTarget);
                const action = item.attr('data-action');
                const label = item.attr('data-label');
                const icon = item.attr('data-icon');

                const mainBtn = html.find('.beneos-bi-bulk-main-btn');
                mainBtn.attr('data-action', action);
                mainBtn.html(`<i class="fa-solid ${icon}"></i> ${label}`);

                html.find('.beneos-bi-bulk-split-btn .beneos-bi-bulk-dropdown-menu').removeClass('open');
            });

            // Split Button main action execution
            html.on('click', '.beneos-bi-bulk-main-btn', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isImporting) return;

                const action = $(e.currentTarget).attr('data-action');
                
                if (action === "bulk-uninstall") {
                    const packagesToUninstall = this.filteredPackages;
                    if (packagesToUninstall.length === 0) {
                        ui.notifications.warn("No visible map packs to uninstall.");
                        return;
                    }
                    this.runBulkUninstall(html, packagesToUninstall);
                    return;
                }

                let forceDownload = true;
                let forceInstall = true;

                if (action === "bulk-download") {
                    forceDownload = true;
                    forceInstall = false;
                } else if (action === "bulk-install") {
                    forceDownload = false;
                    forceInstall = true;
                }

                const itemsToImport = this.filteredPackages.map(pkg => pkg.id);
                if (itemsToImport.length === 0) {
                    ui.notifications.warn("No visible map packs to bulk process.");
                    return;
                }

                this.runBatchImport(html, itemsToImport, forceDownload, forceInstall);
            });

            // Inline card actions: Single Download
            html.on('click', '.action-card-download', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isImporting) return;

                const card = $(e.currentTarget);
                const pkgId = card.attr('data-package-id');

                if (!pkgId) {
                    ui.notifications.error("Could not resolve map pack package for this card.");
                    return;
                }

                this.runBatchImport(html, [pkgId], true, false);
            });

            // Inline card actions: Single Install
            html.on('click', '.action-card-install', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isImporting) return;

                const card = $(e.currentTarget);
                const pkgId = card.attr('data-package-id');

                if (!pkgId) {
                    ui.notifications.error("Could not resolve map pack package for this card.");
                    return;
                }

                const isInstalled = card.hasClass('status-completed');
                const isPartial = card.hasClass('status-partial');

                if (isInstalled || isPartial) {
                    const pkg = this.packages.find(p => p.id?.toString() === pkgId.toString());
                    const pkgName = pkg?.name || "Unknown Package";
                    this.uninstallPackage(pkgName, pkgId, true, html);
                    return;
                }

                this.runBatchImport(html, [pkgId], false, true);
            });

            // Search bar input
            html.on('input', '.beneos-bi-search', (e) => {
                this.searchQuery = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });

            // Dynamic filter dropdowns change
            html.on('change', '.beneos-bi-select.filter-biome', (e) => {
                this.filterBiome = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-show', (e) => {
                this.filterShow = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-brightness', (e) => {
                this.filterBrightness = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-grid', (e) => {
                this.filterGrid = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-type', (e) => {
                this.filterType = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-campaign', (e) => {
                this.filterCampaign = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-release', (e) => {
                this.filterRelease = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });

            // Reset search trigger
            html.on('click', '.action-reset-search', () => {
                this.searchQuery = "";
                this.filterBiome = "any";
                this.filterBrightness = "any";
                this.filterGrid = "any";
                this.filterType = "any";
                this.filterCampaign = "any";
                this.filterRelease = "any";
                this.filterShow = "any";
                this.filterResolution = "4k";
                this.filterSubscribed = "any";
                this.showHD = false;
                this.show4K = true;
                this.showSubscribedOnly = false;
                this.optionCleanInstall = true;
                this.optionAutoDetect = true;
                this.optionDownload = true;
                this.optionInstall = true;
                this.optionSuppressScenePacker = true;
                this.optionSuppressBeneos = true;
                this.optionShowInfoPanel = true;

                html.find('.beneos-bi-search').val("");
                html.find('.beneos-bi-select.filter-biome').val("any");
                html.find('.beneos-bi-select.filter-brightness').val("any");
                html.find('.beneos-bi-select.filter-grid').val("any");
                html.find('.beneos-bi-select.filter-type').val("any");
                html.find('.beneos-bi-select.filter-campaign').val("any");
                html.find('.beneos-bi-select.filter-release').val("any");
                html.find('.beneos-bi-select.filter-show').val("any");
                html.find('.beneos-bi-select.filter-resolution').val("4k");
                html.find('.beneos-bi-select.filter-subscribed').val("any");
                html.find('.beneos-bi-check-clean').prop('checked', true);
                html.find('.beneos-bi-check-autodetect').prop('checked', true);
                html.find('.beneos-bi-check-suppress-scenepacker').prop('checked', true);
                html.find('.beneos-bi-check-suppress-beneos').prop('checked', true);
                html.find('.beneos-bi-check-show-infopanel').prop('checked', true);

                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });

            // Resolution filters
            html.on('change', '.beneos-bi-select.filter-resolution', (e) => {
                this.filterResolution = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });
            html.on('change', '.beneos-bi-select.filter-subscribed', (e) => {
                this.filterSubscribed = e.currentTarget.value;
                this.triggerInteractiveFilter(html, () => {
                    this.applyFilters();
                    this.refreshList(html);
                });
            });

            // Options checkboxes listeners
            html.on('change', '.beneos-bi-check-clean', (e) => {
                this.optionCleanInstall = e.currentTarget.checked;
            });
            html.on('change', '.beneos-bi-check-autodetect', (e) => {
                this.optionAutoDetect = e.currentTarget.checked;
            });
            html.on('change', '.beneos-bi-check-suppress-scenepacker', (e) => {
                this.optionSuppressScenePacker = e.currentTarget.checked;
            });
            html.on('change', '.beneos-bi-check-suppress-beneos', (e) => {
                this.optionSuppressBeneos = e.currentTarget.checked;
            });
            html.on('change', '.beneos-bi-check-show-infopanel', (e) => {
                this.optionShowInfoPanel = e.currentTarget.checked;
                this.render({ force: true });
            });

            // Help Guide Dialog
            html.on('click', '.action-help', () => {
                this.showHelpDialog();
            });

            // Open Moulinette config UI button
            html.on('click', '.action-link-moulinette', () => {
                game.modules.get("moulinette")?.user?.render(true);
            });

            // Patreon/Discord logins
            html.on('click', '.action-login-patreon', () => {
                this.startOauth('patreon');
            });
            html.on('click', '.action-login-discord', () => {
                this.startOauth('discord');
            });

            // Retry Connection button
            html.on('click', '.action-retry', () => {
                this.fetchPackages();
            });

            // Resume Queue session
            html.on('click', '.action-resume-queue', () => {
                this.runBatchImport(html);
            });

            // Discard Queue session
            html.on('click', '.action-discard-queue', () => {
                sessionStorage.removeItem("beneos-batch-importer-resume-state");
                this.resumeQueueList = null;
                this.importResults = [];
                this.importedCount = 0;
                this.totalToImport = 0;
                this.render({ force: true });
            });
        }



        /**
         * Refresh only the package list inside the existing window
         */
        refreshList(html = null) {
            const activeHtml = (html && html.length) ? html : $(this.element);
            if (!activeHtml || activeHtml.length === 0) return;
            const list = activeHtml.find('.beneos-bi-list');
            if (list.length === 0) return;
            list.empty();

            if (this.isLoading) {
                list.append(`
                    <div class="beneos-bi-empty" style="padding: 60px 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: 200px;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 2.5em; color: #c89c5e;"></i>
                        <div style="font-size: 14px; font-weight: bold; color: #ebe9e5;">Connecting to Moulinette Cloud...</div>
                        <div style="font-size: 11px; color: #a59d8e; text-align: center; max-width: 320px;">Fetching available battlemap collections and subscription tiers. Please wait.</div>
                    </div>
                `);
                return;
            }

            // Dynamically update matches count in content header
            const matchesCount = this.viewMode === 'pack' ? this.filteredPackages.length : this.filteredMaps.length;
            activeHtml.find('.beneos-bi-matches-count').text(`Showing ${matchesCount} matches`);

            // Darken and disable filters that don't make sense for Map Pack (Grid Size, Type)
            const isPack = this.viewMode === "pack";
            const gridSelect = activeHtml.find('.filter-grid');
            const typeSelect = activeHtml.find('.filter-type');
            if (isPack) {
                gridSelect.prop('disabled', true).parent().css({ 'opacity': '0.35', 'pointer-events': 'none' });
                typeSelect.prop('disabled', true).parent().css({ 'opacity': '0.35', 'pointer-events': 'none' });
            } else {
                gridSelect.prop('disabled', false).parent().css({ 'opacity': '1', 'pointer-events': 'auto' });
                typeSelect.prop('disabled', false).parent().css({ 'opacity': '1', 'pointer-events': 'auto' });
            }

            // Layout Mode CSS class toggle
            if (this.viewLayout === "grid") {
                list.addClass("beneos-bi-view-grid");
            } else {
                list.removeClass("beneos-bi-view-grid");
            }

            // RENDER MAP PACK LIST
            if (this.viewMode === "pack") {
                if (this.filteredPackages.length === 0) {
                    list.append('<div class="beneos-bi-empty">No matching scene collections found.</div>');
                    return;
                }

                if (this.groupMode === "group") {
                    // Group packages by Campaign, then by Collection
                    const campaignMap = {};
                    this.filteredPackages.forEach(pkg => {
                        const campaignName = this.getCampaignName(pkg);
                        const collectionName = this.getCollectionName(pkg.name);
                        if (!campaignMap[campaignName]) {
                            campaignMap[campaignName] = {};
                        }
                        if (!campaignMap[campaignName][collectionName]) {
                            campaignMap[campaignName][collectionName] = [];
                        }
                        campaignMap[campaignName][collectionName].push(pkg);
                    });

                    // Render campaigns and collections alphabetically
                    const sortedCampaigns = Object.keys(campaignMap).sort((a, b) => a.localeCompare(b));
                    sortedCampaigns.forEach(campaignName => {
                        list.append(`<div class="beneos-bi-group-campaign-header"><i class="fa-solid fa-map-location-dot"></i> ${campaignName}</div>`);
                        
                        const collections = campaignMap[campaignName];
                        const sortedCollections = Object.keys(collections).sort((a, b) => a.localeCompare(b));
                        sortedCollections.forEach(collectionName => {
                            list.append(`<div class="beneos-bi-group-collection-header"><i class="fa-solid fa-folder-open"></i> ${collectionName}</div>`);
                            
                            const pkgs = collections[collectionName];
                            if (this.filterResolution === "any") {
                                const pkgsByRes = { "4K": [], "HD": [] };
                                pkgs.forEach(pkg => {
                                    const isPkg4K = pkg.name.toLowerCase().includes("4k") || pkg.name.toLowerCase().includes("uhd") || pkg.name.toLowerCase().includes("ultra hd");
                                    if (isPkg4K) pkgsByRes["4K"].push(pkg);
                                    else pkgsByRes["HD"].push(pkg);
                                });
                                
                                if (pkgsByRes["4K"].length > 0) {
                                    list.append(`<div class="beneos-bi-group-res-header"><i class="fa-solid fa-expand"></i> 4K Resolution</div>`);
                                    pkgsByRes["4K"].forEach(pkg => list.append(this.buildPackCardHTML(pkg)));
                                }
                                if (pkgsByRes["HD"].length > 0) {
                                    list.append(`<div class="beneos-bi-group-res-header"><i class="fa-solid fa-compress"></i> HD Resolution</div>`);
                                    pkgsByRes["HD"].forEach(pkg => list.append(this.buildPackCardHTML(pkg)));
                                }
                            } else {
                                pkgs.forEach(pkg => {
                                    list.append(this.buildPackCardHTML(pkg));
                                });
                            }
                        });
                    });
                } else {
                    // Render packages flat
                    this.filteredPackages.forEach(pkg => {
                        list.append(this.buildPackCardHTML(pkg));
                    });
                }
            } else {
                // RENDER INDIVIDUAL MAPS LIST
                if (this.filteredMaps.length === 0) {
                    list.append('<div class="beneos-bi-empty">No matching individual maps found.</div>');
                    return;
                }

                if (this.groupMode === "group") {
                    // Group maps by Campaign, then by Collection, then by Map Pack
                    const campaignMap = {};
                    this.filteredMaps.forEach(map => {
                        const campaignName = map.properties?.adventure && map.properties.adventure !== "None" ? map.properties.adventure : "Independent Releases";
                        const pkgName = this.packages.find(p => p.id?.toString() === map.packageId?.toString())?.name || map.properties?.download_pack || "General Releases";
                        const collectionName = this.getCollectionName(pkgName);

                        if (!campaignMap[campaignName]) {
                            campaignMap[campaignName] = {};
                        }
                        if (!campaignMap[campaignName][collectionName]) {
                            campaignMap[campaignName][collectionName] = {};
                        }
                        if (!campaignMap[campaignName][collectionName][pkgName]) {
                            campaignMap[campaignName][collectionName][pkgName] = [];
                        }
                        campaignMap[campaignName][collectionName][pkgName].push(map);
                    });

                    // Render sorted
                    const sortedCampaigns = Object.keys(campaignMap).sort((a, b) => a.localeCompare(b));
                    sortedCampaigns.forEach(campaignName => {
                        list.append(`<div class="beneos-bi-group-campaign-header"><i class="fa-solid fa-map-location-dot"></i> ${campaignName}</div>`);

                        const collections = campaignMap[campaignName];
                        const sortedCollections = Object.keys(collections).sort((a, b) => a.localeCompare(b));
                        sortedCollections.forEach(collectionName => {
                            list.append(`<div class="beneos-bi-group-collection-header"><i class="fa-solid fa-folder-open"></i> ${collectionName}</div>`);

                            const packs = collections[collectionName];
                            const sortedPacks = Object.keys(packs).sort((a, b) => a.localeCompare(b));
                            sortedPacks.forEach(pkgName => {
                                list.append(`<div class="beneos-bi-group-pack-header"><i class="fa-solid fa-layer-group"></i> ${pkgName}</div>`);

                                const mapsList = packs[pkgName];
                                if (this.filterResolution === "any") {
                                    const mapsByRes = { "4K": [], "HD": [] };
                                    mapsList.forEach(map => {
                                        if (map.is4K) mapsByRes["4K"].push(map);
                                        else mapsByRes["HD"].push(map);
                                    });
                                    
                                    if (mapsByRes["4K"].length > 0) {
                                        list.append(`<div class="beneos-bi-group-res-header"><i class="fa-solid fa-expand"></i> 4K Resolution</div>`);
                                        mapsByRes["4K"].forEach(map => list.append(this.buildMapCardHTML(map)));
                                    }
                                    if (mapsByRes["HD"].length > 0) {
                                        list.append(`<div class="beneos-bi-group-res-header"><i class="fa-solid fa-compress"></i> HD Resolution</div>`);
                                        mapsByRes["HD"].forEach(map => list.append(this.buildMapCardHTML(map)));
                                    }
                                } else {
                                    mapsList.forEach(map => {
                                        list.append(this.buildMapCardHTML(map));
                                    });
                                }
                            });
                        });
                    });
                } else {
                    // Render maps flat
                    this.filteredMaps.forEach(map => {
                        list.append(this.buildMapCardHTML(map));
                    });
                }
            }
        }

        /**
         * Direct OAuth authorization flow
         */
        async startOauth(provider) {
            if (this.isAuthenticating) return;

            const state = foundry.utils.randomID(26);
            let url = "";

            if (provider === "patreon") {
                const el = "K3ofcL8XyaObRrO_5VPuzXEPnOVCIW3fbLIt6Vygt_YIM6IKxA404ZQ0pZbZ0VkB";
                url = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${el}&redirect_uri=https://assets.moulinette.cloud/patreon/callback&scope=identity identity.memberships&state=${state}`;
            } else {
                const tl = "1104472072853405706";
                url = `https://discord.com/oauth2/authorize?response_type=code&client_id=${tl}&scope=identify guilds guilds.members.read&redirect_uri=https://assets.moulinette.cloud/discord/callback&state=${state}`;
            }

            this.logStatus(`Opening OAuth window for Moulinette ${provider === 'patreon' ? 'Patreon' : 'Discord'} sign in...`);
            
            // Set Moulinette temporary session settings
            await game.settings.set("moulinette", "session_ID", state);
            
            // Open window
            window.open(url, "_blank");

            // Update app auth states
            this.isAuthenticating = true;
            this.authProvider = provider;
            this.timerSecondsLeft = 120;
            this.render({ force: true });

            // Setup polling timer
            if (this.authTimer) clearInterval(this.authTimer);
            
            this.authTimer = setInterval(async () => {
                this.timerSecondsLeft -= 2;
                
                let authenticated = false;
                try {
                    const client = game.modules.get("moulinette")?.cloudclient;
                    if (client?.isUserAuthenticated) {
                        authenticated = await client.isUserAuthenticated(state, provider);
                    }
                } catch (e) {
                    console.error("Beneos Batch Importer | Error checking auth status:", e);
                }

                if (authenticated || this.timerSecondsLeft <= 0) {
                    clearInterval(this.authTimer);
                    this.authTimer = null;
                    this.isAuthenticating = false;
                    
                    // Clear Moulinette cache
                    game.modules.get("moulinette")?.cache?.clearCache();
                    
                    if (authenticated) {
                        this.logSuccess("Successfully authenticated Moulinette account!");
                        ui.notifications.info("Moulinette account authenticated successfully!");
                    } else {
                        this.logError("Authentication timed out or failed.");
                        ui.notifications.error("Moulinette authentication timed out.");
                    }
                    
                    // Re-fetch packages (which will update the permanent session ID in Settings)
                    await this.fetchPackages();
                } else {
                    // Update only the seconds count inside the DOM to avoid re-rendering entire window
                    const timerEl = $('.beneos-bi-auth-alert strong');
                    if (timerEl.length) {
                        timerEl.text(`${this.timerSecondsLeft} seconds left`);
                    }
                }
            }, 2000);
        }

        // Cleaned up duplicate refreshList and updateImportButton methods to prevent prototype override

        /**
         * Log a line to the terminal UI console
         */
        logStatus(message, type = "info") {
            const consoleEl = $('.beneos-bi-console');
            if (consoleEl.length) {
                consoleEl.append(`<p class="beneos-bi-log-entry ${type}">[${new Date().toLocaleTimeString()}] ${message}</p>`);
                consoleEl.scrollTop(consoleEl[0].scrollHeight);
            }
            console.log(`Beneos Batch Importer | ${message}`);
        }

        logError(message) {
            this.logStatus(message, "error");
        }

        logSuccess(message) {
            this.logStatus(message, "success");
        }

        /**
         * Display Guide Dialog
         */
        /**
         * Perform recursive cleanup of scenes, journal entries, and folders matching package and map targets.
         */
        async uninstallPackage(pkgName, pkgId = null, showConfirm = true, html = null) {
            const performUninstall = async () => {
                this.logStatus(`Uninstalling "${pkgName}"...`, "warning");
                
                const targets = new Set();
                const cleanTarget = pkgName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                targets.add(cleanTarget);
                
                const constituentNames = this.getConstituentMapNames(pkgId, pkgName);
                for (const mapName of constituentNames) {
                    const cleanMapName = mapName.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                    if (cleanMapName.length > 4) {
                        targets.add(cleanMapName);
                    }
                }

                // 1. Direct Scene Deletion
                const scenesToDelete = game.scenes.filter(s => {
                    const cleanScene = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanScene.includes(t) || t.includes(cleanScene)) return true;
                    }
                    return false;
                });

                if (scenesToDelete.length > 0) {
                    this.logStatus(`Found ${scenesToDelete.length} VTT scenes to remove for "${pkgName}". Deleting...`);
                    for (const scene of scenesToDelete) {
                        try {
                            await scene.delete();
                        } catch (err) {
                            this.logError(`Failed to delete scene "${scene.name}": ${err.message}`);
                        }
                    }
                }

                // 2. Direct Journal Deletion
                const journalsToDelete = game.journal.filter(j => {
                    const cleanJournal = j.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanJournal.includes(t) || t.includes(cleanJournal)) return true;
                    }
                    return false;
                });

                if (journalsToDelete.length > 0) {
                    this.logStatus(`Found ${journalsToDelete.length} VTT journals to remove for "${pkgName}". Deleting...`);
                    for (const journal of journalsToDelete) {
                        try {
                            await journal.delete();
                        } catch (err) {
                            this.logError(`Failed to delete journal "${journal.name}": ${err.message}`);
                        }
                    }
                }
                
                // 3. Folder Deletion
                const folders = game.folders.filter(f => {
                    if (f.type !== "Scene" && f.type !== "JournalEntry") return false;
                    const cleanFolder = f.name.toLowerCase().replace(/\s*(4k|hd|uhd|ultra hd|high def).*$/i, "").replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanFolder === t || cleanFolder.includes(t) || t.includes(cleanFolder)) {
                            return true;
                        }
                    }
                    return false;
                });
                
                if (folders.length > 0) {
                    this.logStatus(`Found ${folders.length} VTT folders to remove for "${pkgName}". Deleting...`);
                    for (const folder of folders) {
                        try {
                            await folder.delete({ deleteSubfolders: true, deleteContents: true });
                            this.logSuccess(`Deleted folder "${folder.name}" (${folder.type}) and all its contents.`);
                        } catch (err) {
                            this.logError(`Failed to delete folder "${folder.name}": ${err.message}`);
                        }
                    }
                }

                // 4. Safely clean up any empty folders matching targets that might be left over
                const emptyFolders = game.folders.filter(f => {
                    if (f.type !== "Scene" && f.type !== "JournalEntry") return false;
                    if (f.contents.length > 0 || f.children?.length > 0) return false;
                    const cleanFolder = f.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    for (const t of targets) {
                        if (cleanFolder.includes(t) || t.includes(cleanFolder)) return true;
                    }
                    return false;
                });
                for (const folder of emptyFolders) {
                    try {
                        await folder.delete();
                    } catch (e) {}
                }

                // Remove from session cache so that status checks immediately report as uninstalled
                const sessionKey = this.cleanSessionKey(pkgName);
                this.installedPackagesSession?.delete(sessionKey);
                
                // Clear the status caches Map so the UI is updated immediately on next refreshList
                this.installStatusCache?.clear();
                this.downloadStatusCache?.clear();
                
                this.logSuccess(`Successfully uninstalled "${pkgName}" from this World.`);
                
                if (html) {
                    this.refreshList(html);
                } else {
                    const win = $('.beneos-batch-importer-window');
                    if (win.length > 0) this.refreshList(win);
                }
            };

            if (showConfirm) {
                new Dialog({
                    title: `Uninstall ${pkgName}`,
                    content: `
                        <div style="font-family: 'Signika', sans-serif; padding: 5px;">
                            <p>Are you sure you want to uninstall <strong>${pkgName}</strong> from this World?</p>
                            <p style="color: #ea868f; font-size: 0.95em;">This will permanently delete all associated scenes, journals, and folders for this package from the current World's database.</p>
                        </div>
                    `,
                    buttons: {
                        yes: {
                            icon: '<i class="fas fa-trash"></i>',
                            label: "Yes, Uninstall",
                            callback: async () => {
                                await performUninstall();
                            }
                        },
                        no: {
                            icon: '<i class="fas fa-times"></i>',
                            label: "Cancel"
                        }
                    },
                    default: "no"
                }, { classes: ["dialog", "beneos-bi-guide-dialog"] }).render(true);
            } else {
                await performUninstall();
            }
        }

        /**
         * Sequentially uninstall all visible filtered packages.
         */
        async runBulkUninstall(html, packagesToUninstall) {
            const count = packagesToUninstall.length;
            new Dialog({
                title: "Bulk Uninstall Confirmation",
                content: `
                    <div style="font-family: 'Signika', sans-serif; padding: 5px;">
                        <p>Are you sure you want to uninstall all <strong>${count}</strong> currently filtered/visible packages from this World?</p>
                        <p style="color: #ea868f; font-size: 0.95em;">This will permanently delete all associated scenes, journals, and folders from this World's database for these packages.</p>
                    </div>
                `,
                buttons: {
                    yes: {
                        icon: '<i class="fas fa-trash"></i>',
                        label: "Yes, Uninstall All",
                        callback: async () => {
                            this.isImporting = true;
                            this.logStatus(`Starting bulk uninstall of ${count} packages...`, "warning");
                            
                            // Initialize popup progress bar
                            const popup = html.find('.beneos-bi-popup-progress');
                            if (popup.length > 0) {
                                popup.find('.beneos-bi-popup-progress-title').text("Bulk Uninstallation Progress");
                                popup.find('.beneos-bi-popup-progress-bar').css('width', '0%');
                                popup.find('.beneos-bi-popup-progress-text').text(`0% (0 / ${count} uninstalled)`);
                                popup.addClass('active');
                            }
                            
                            let uninstalledCount = 0;
                            for (const pkg of packagesToUninstall) {
                                try {
                                    await this.uninstallPackage(pkg.name, pkg.id, false);
                                } catch (err) {
                                    this.logError(`Failed to uninstall "${pkg.name}": ${err.message}`);
                                }
                                uninstalledCount++;
                                const pct = Math.round((uninstalledCount / count) * 100);
                                html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                                if (popup.length > 0) {
                                    popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                                    popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${uninstalledCount} / ${count} completed)`);
                                }
                            }
                            
                            // Final cache reset at the end of bulk uninstall
                            this.installStatusCache?.clear();
                            this.downloadStatusCache?.clear();

                            this.isImporting = false;
                            this.logSuccess(`Bulk uninstallation of ${count} packages completed!`);
                            
                            setTimeout(() => {
                                $('.beneos-bi-progress-bar').css('width', '0%');
                                if (popup.length > 0) {
                                    popup.removeClass('active');
                                }
                                this.refreshList(html);
                            }, 500);
                        }
                    },
                    no: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel"
                    }
                },
                default: "no"
            }, { classes: ["dialog", "beneos-bi-guide-dialog"] }).render(true);
        }

        showHelpDialog() {
            new Dialog({
                title: "Beneos Batch-Importer Guide",
                content: `
                    <style>
                        .beneos-bi-guide-dialog.dialog .window-content {
                            background: #0c0a09 !important;
                            color: #ebe9e5 !important;
                            border: 1px solid #c89c5e !important;
                            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.7) !important;
                        }
                        .beneos-bi-guide-dialog.dialog .dialog-buttons {
                            background: #151210 !important;
                            border-top: 1px solid #2e2920 !important;
                            padding: 8px !important;
                        }
                        .beneos-bi-guide-dialog.dialog .dialog-button {
                            background: #242019 !important;
                            color: #ebe9e5 !important;
                            border: 1px solid #c89c5e !important;
                            border-radius: 4px !important;
                            cursor: pointer !important;
                            font-weight: bold !important;
                            transition: background 0.2s !important;
                        }
                        .beneos-bi-guide-dialog.dialog .dialog-button:hover {
                            background: #c89c5e !important;
                            color: #0c0a09 !important;
                        }
                    </style>
                    <div style="font-family: 'Signika', sans-serif; color: #ebe9e5; line-height: 1.5; padding: 5px;">
                        <h3 style="color: #c89c5e; border-bottom: 2px solid #2e2920; padding-bottom: 6px; margin-top: 0; font-size: 1.25em; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-question-circle"></i> Importer User Guide
                        </h3>
                        
                        <h4 style="color: #ffd8a4; margin-top: 12px; margin-bottom: 6px;"><i class="fas fa-broom" style="color: #c89c5e; margin-right: 6px;"></i> How "Clean Install: Auto-Detect" Works</h4>
                        <p style="margin-bottom: 8px; color: #a59d8e; font-size: 0.95em;">
                            ScenePacker checks your VTT sidebar folders. If they already exist, they are skipped entirely, meaning any missing or corrupt assets on disk will never be retried.
                        </p>
                        <p style="margin-bottom: 12px; color: #a59d8e; font-size: 0.95em;">
                            Checking <strong>Clean Install: Auto-Detect</strong> runs an automated integrity scan before each import. If folders are empty or if local background media files are missing on disk, it triggers a safe purge of those VTT folders to force a fresh download. If all files are intact, it runs in super-fast skipped validation mode! It's the ultimate set-and-forget experience.
                        </p>
 
                        <h4 style="color: #ffd8a4; margin-top: 12px; margin-bottom: 6px;"><i class="fas fa-filter" style="color: #c89c5e; margin-right: 6px;"></i> Filters & State Sync</h4>
                        <p style="margin-bottom: 8px; color: #a59d8e; font-size: 0.95em;">
                            Toggling the Resolution and Patreon Status filters updates the visible list. However, if you check packages and then filter them out, they remain in the queue. 
                        </p>
                        <p style="margin-bottom: 12px; color: #a59d8e; font-size: 0.95em;">
                            The main button will show a count like <code>(2 visible / 5 total)</code>. To prevent accidental HD downloads, **the importer will only process packages currently matching your visible filters**! You can also click the red <strong>Clear Hidden Selections</strong> button to flush hidden selections.
                        </p>
 
                        <h4 style="color: #ffd8a4; margin-top: 12px; margin-bottom: 6px;"><i class="fas fa-volume-mute" style="color: #c89c5e; margin-right: 6px;"></i> Popup & Window Suppression</h4>
                        <p style="margin-bottom: 8px; color: #a59d8e; font-size: 0.95em;">
                            To ensure an uninterrupted flow, all modal popups (such as <em>"Some files didn't fully install"</em>) and welcome journal sheets are completely silenced during execution, side-by-side window rendering is automated, and a final summary report is shown at the very end.
                        </p>
                        <p style="margin-bottom: 0; color: #a59d8e; font-size: 0.95em;">
                            You can customize this behavior via the sidebar Options checkboxes: <strong>Suppress Scene Packer popups</strong> controls Scene Packer reload prompts; <strong>Suppress Beneos Battlemaps popups</strong> handles welcome pages and install watcher popups; <strong>Show info panel</strong> toggles the footer information box.
                        </p>
                    </div>
                `,
                buttons: {
                    ok: {
                        label: "Close"
                    }
                },
                default: "ok"
            }, { width: 500, classes: ["dialog", "beneos-bi-guide-dialog"] }).render(true);
        }
        showSummaryDialog(wasCancelled, isInstallActive = true) {
            const rows = this.importResults.map(r => {
                const isSuccess = r.status === 'success';
                const isSkipped = r.status === 'skipped';
                
                const bg = isSuccess ? 'rgba(139, 191, 139, 0.15)' : (isSkipped ? 'rgba(245, 201, 146, 0.15)' : 'rgba(216, 130, 112, 0.15)');
                const color = isSuccess ? '#8bbf8b' : (isSkipped ? '#f5c992' : '#d88270');
                const border = isSuccess ? 'rgba(139, 191, 139, 0.3)' : (isSkipped ? 'rgba(245, 201, 146, 0.3)' : 'rgba(216, 130, 112, 0.3)');
                const badgeText = r.status.toUpperCase();
                
                return `
                    <tr style="border-bottom: 1px solid #2e2920;">
                        <td style="padding: 8px; font-weight: bold; color: #ebe9e5; white-space: nowrap;">${r.name}</td>
                        <td style="padding: 8px; text-align: center;"><span class="beneos-bi-badge ${r.resolution === '4K' ? 'res-4k' : 'res-hd'}">${r.resolution}</span></td>
                        <td style="padding: 8px; text-align: center;">
                            <span style="background: ${bg}; color: ${color}; border: 1px solid ${border}; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 4px;">
                                <i class="${isSuccess ? 'fa-solid fa-circle-check' : (isSkipped ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-xmark')}"></i> ${badgeText}
                            </span>
                        </td>
                        <td style="padding: 8px; color: #a59d8e; font-size: 0.9em; white-space: nowrap; font-family: monospace;">${r.error || 'None'}</td>
                    </tr>
                `;
            }).join('');

            const titleText = isInstallActive ? "Batch Import Queue Summary" : "Batch Download Queue Summary";
            const headerColor = "#c89c5e";
            const statusVerb = isInstallActive ? "imported" : "downloaded";
            
            let noteContent = "";
            if (isInstallActive) {
                noteContent = `
                    <p style="color: #ff8f95; font-size: 0.95em; margin-bottom: 12px; line-height: 1.4;">
                        <strong>Note:</strong> Foundry VTT requires a single tab refresh to rebuild folders, register new journal entries, and configure actor linkages correctly.
                    </p>
                    <p style="font-size: 1.05em; font-weight: bold; margin-bottom: 0;">Would you like to refresh your browser tab now?</p>
                `;
            } else {
                noteContent = `
                    <p style="color: #8bbf8b; font-size: 0.95em; margin-bottom: 12px; line-height: 1.4;">
                        <strong>Packs downloaded successfully:</strong> The assets are now stored on disk and ready to be installed in your World whenever you are ready!
                    </p>
                `;
            }
            const content = `
                <style>
                    .beneos-bi-guide-dialog.window-app {
                        background: #0c0a09 !important;
                        border: 1px solid #c89c5e !important;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8) !important;
                        opacity: 1 !important;
                    }
                    .beneos-bi-guide-dialog.window-app .window-header {
                        background: #151210 !important;
                        border-bottom: 1px solid #2e2920 !important;
                        color: #ebe9e5 !important;
                        opacity: 1 !important;
                    }
                    .beneos-bi-guide-dialog.window-app .window-header .window-title {
                        color: #ebe9e5 !important;
                        opacity: 1 !important;
                    }
                    .beneos-bi-guide-dialog.window-app .window-content {
                        background: #0c0a09 !important;
                        color: #ebe9e5 !important;
                        opacity: 1 !important;
                    }
                    .beneos-bi-guide-dialog.dialog .window-content {
                        background: #0c0a09 !important;
                        color: #ebe9e5 !important;
                        border: 1px solid #c89c5e !important;
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.7) !important;
                    }
                    .beneos-bi-guide-dialog.dialog .dialog-buttons {
                        background: #151210 !important;
                        border-top: 1px solid #2e2920 !important;
                        padding: 8px !important;
                    }
                    .beneos-bi-guide-dialog.dialog .dialog-button {
                        background: #242019 !important;
                        color: #ebe9e5 !important;
                        border: 1px solid #c89c5e !important;
                        border-radius: 4px !important;
                        cursor: pointer !important;
                        font-weight: bold !important;
                        transition: background 0.2s !important;
                    }
                    .beneos-bi-guide-dialog.dialog .dialog-button:hover {
                        background: #c89c5e !important;
                        color: #0c0a09 !important;
                    }
                </style>
                <div style="font-family: 'Signika', sans-serif; color: #ebe9e5; background: #0c0a09; padding: 5px; border-radius: 6px;">
                    <p style="margin-bottom: 12px; font-size: 1.05em; line-height: 1.4; border-bottom: 1px solid #2e2920; padding-bottom: 8px;">
                        <strong>${wasCancelled ? 'Queue was stopped by user.' : 'Batch process completed!'}</strong> 
                        Successfully ${statusVerb} ${this.importedCount} of ${this.totalToImport} selected packages.
                    </p>
                    <div style="max-height: 300px; overflow-y: auto; border: 1px solid #2e2920; border-radius: 4px; margin-bottom: 12px; background: #0c0a09;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95em;">
                            <thead>
                                <tr style="background: #151210; border-bottom: 2px solid #2e2920; color: #ebe9e5;">
                                    <th style="padding: 8px; white-space: nowrap;">Package Name</th>
                                    <th style="padding: 8px; text-align: center; white-space: nowrap;">Resolution</th>
                                    <th style="padding: 8px; text-align: center; white-space: nowrap;">Status</th>
                                    <th style="padding: 8px; white-space: nowrap;">Details / Errors</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                    ${noteContent}
                </div>
            `;

            if (isInstallActive) {
                Dialog.confirm({
                    title: "Batch Import Results Summary",
                    content: content,
                    yes: () => window.location.reload(),
                    no: () => {
                        setTimeout(() => {
                            this.selectedPackages.clear();
                            $('.beneos-bi-progress-bar').css('width', '0%');
                            this.logStatus("Resetting UI. You should reload manually soon to ensure absolute asset registration.");
                            const win = $('.beneos-batch-importer-window');
                            this.refreshList(win);
                        }, 50);
                    },
                    options: { width: 900, classes: ["dialog", "beneos-bi-guide-dialog"] }
                });
            } else {
                new Dialog({
                    title: "Batch Download Results Summary",
                    content: content,
                    buttons: {
                        ok: {
                            label: "Close",
                            callback: () => {
                                setTimeout(() => {
                                    this.selectedPackages.clear();
                                    $('.beneos-bi-progress-bar').css('width', '0%');
                                    this.logStatus("Resetting UI. Download complete, no refresh needed.");
                                    const win = $('.beneos-batch-importer-window');
                                    this.refreshList(win);
                                }, 50);
                            }
                        }
                    },
                    default: "ok"
                }, { width: 900, classes: ["dialog", "beneos-bi-guide-dialog"] }).render(true);
            }
        }

                async checkNeedsCleanInstall(pkgName) {
            // Find the VTT Scene folder and Journal Entry folder matching the pack name
            const sceneFolder = game.folders.find(f => f.name === pkgName && f.type === "Scene");
            const journalFolder = game.folders.find(f => f.name === pkgName && f.type === "JournalEntry");

            // If folders don't exist in the world at all, it's a first-time install. No need to delete.
            if (!sceneFolder && !journalFolder) {
                return false;
            }

            // If folders exist but contain no elements, it's an interrupted/empty install. Needs clean install!
            if (sceneFolder && sceneFolder.contents.length === 0) {
                return true;
            }
            if (journalFolder && journalFolder.contents.length === 0) {
                return true;
            }

            // Verify integrity of scene background media on disk using fast HEAD requests
            if (sceneFolder) {
                const scenes = game.scenes.filter(s => s.folder?.id === sceneFolder.id);
                for (const scene of scenes) {
                    const bgPath = scene.img || scene._source?.background?.src;
                    if (bgPath) {
                        try {
                            const res = await fetch(bgPath, { method: 'HEAD' });
                            if (res.status === 404 || !res.ok) {
                                this.logStatus(`[Auto-Detect] Missing background asset detected for "${scene.name}" on disk: ${bgPath}`, "error");
                                return true; // Missing files, trigger clean install!
                            }
                        } catch (e) {
                            console.error("Beneos Batch Importer | File integrity check failed:", e);
                        }
                    }
                }
            }

            return false; // Valid, complete installation!
        }

        /**
         * Loop over and import each selected package procedurally
         */
        /**
         * Loop over and import each selected package procedurally
         */
        async runBatchImport(html, itemsToImport = null, forceDownload = null, forceInstall = null) {
            this.isImporting = true;
            this.isCancelled = false;
            this.importResults = [];
            this.currentlyImportingId = null;
            this.completedImportingIds = new Set();
            this.failedImportingIds = new Set();
            
            // Clear any existing progress states in the list DOM
            html.find('.beneos-bi-item').removeClass('beneos-bi-item-processing beneos-bi-item-completed beneos-bi-item-failed');
            
            // Disable all interactive UI elements
            html.find('input, select, button').prop('disabled', true);
            html.find('.beneos-bi-view-btn, .beneos-bi-bulk-dropdown-trigger, .beneos-bi-card-btn, .action-help, .action-retry').css('pointer-events', 'none').css('opacity', '0.5');

            // Select only the ones that are visible/filtered to prevent accidental hidden HD downloads
            const visibleIds = new Set(this.filteredPackages.map(pkg => pkg.id));
            let selectedList = [];
            
            if (this.resumeQueueList && this.resumeQueueList.length > 0) {
                selectedList = this.resumeQueueList;
                this.resumeQueueList = null; // Clear to prevent loops
                this.logStatus(`Resuming active import queue with ${selectedList.length} packages remaining.`);
            } else if (itemsToImport && itemsToImport.length > 0) {
                selectedList = itemsToImport;
                this.totalToImport = selectedList.length;
                this.importedCount = 0;
            } else {
                selectedList = Array.from(this.selectedPackages).filter(id => visibleIds.has(id));
                this.totalToImport = selectedList.length;
                this.importedCount = 0;
            }

            const isDownloadActive = forceDownload !== null ? forceDownload : this.optionDownload;
            const isInstallActive = forceInstall !== null ? forceInstall : this.optionInstall;

            if (this.totalToImport === 0) {
                this.logError("No visible packages selected to import.");
                this.isImporting = false;
                
                // Re-enable UI
                html.find('input, select, button').prop('disabled', false);
                html.find('.beneos-bi-view-btn, .beneos-bi-bulk-dropdown-trigger, .beneos-bi-card-btn, .action-help, .action-retry').css('pointer-events', 'auto').css('opacity', '1');
                if (!this.isLinked) {
                    html.find('.beneos-bi-check-hd, .beneos-bi-check-4k, .beneos-bi-check-subscribed, .beneos-bi-check-clean, .beneos-bi-check-autodetect, .beneos-bi-check-download, .beneos-bi-check-install').prop('disabled', true);
                }
                return;
            }

            this.logStatus(`Starting batch import of ${this.totalToImport} packages. Mode: Download=${isDownloadActive ? 'ON' : 'OFF'}, Install=${isInstallActive ? 'ON' : 'OFF'}`);

            // Initialize, reveal and bind the progress popup banner
            const popup = html.find('.beneos-bi-popup-progress');
            if (popup.length > 0) {
                popup.find('.beneos-bi-popup-progress-bar').css('width', '0%');
                popup.find('.beneos-bi-popup-progress-text').text(`0% (0 / ${this.totalToImport} completed)`);
                popup.find('.active-item-name').text('Initializing...');
                popup.css('display', 'flex');
                
                // Re-enable and bind the Cancel Queue button
                const cancelBtn = popup.find('.beneos-bi-popup-progress-cancel-btn');
                cancelBtn.prop('disabled', false).html('<i class="fas fa-hand-paper"></i> Cancel Queue');
                cancelBtn.off('click').on('click', (e) => {
                    e.preventDefault();
                    this.isCancelled = true;
                    this.logStatus("Stopping import queue...");
                    cancelBtn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Stopping...');
                });
            }

            const mtSession = game.settings.get("moulinette", "session_ID") || "";
            const originalPrompt = Dialog.prompt;
            const originalCompatMode = CONFIG.compatibility?.mode;
            const originalCallAll = Hooks.callAll;
            const originalCall = Hooks.call;
            
            // Resolve JournalSheet, DocumentSheet, and DocumentSheetV2 classes safely without triggering deprecated global getters in VTT v13+
            const JournalSheetClass = (foundry.appv1?.sheets?.JournalSheet) || globalThis.JournalSheet;
            const originalJournalRender = JournalSheetClass?.prototype?.render;

            const DocumentSheetClass = globalThis.DocumentSheet;
            const originalDocumentSheetRender = DocumentSheetClass?.prototype?.render;

            const DocumentSheetV2Class = foundry.applications?.api?.DocumentSheetV2;
            const originalDocumentSheetV2Render = DocumentSheetV2Class?.prototype?.render;

            // Granular Action Interceptors
            // 1. Download Only (No VTT Documents) - Override createDocuments on key classes
            const originalCreateFolders = Folder.createDocuments;
            const originalCreateScenes = CONFIG.Scene.documentClass.createDocuments;
            const originalCreateJournals = CONFIG.JournalEntry.documentClass.createDocuments;
            const originalCreatePlaylists = CONFIG.Playlist?.documentClass?.createDocuments;
            const originalCreateActors = CONFIG.Actor?.documentClass?.createDocuments;
            
            if (!isInstallActive) {
                Folder.createDocuments = () => Promise.resolve([]);
                CONFIG.Scene.documentClass.createDocuments = () => Promise.resolve([]);
                CONFIG.JournalEntry.documentClass.createDocuments = () => Promise.resolve([]);
                if (CONFIG.Playlist?.documentClass) CONFIG.Playlist.documentClass.createDocuments = () => Promise.resolve([]);
                if (CONFIG.Actor?.documentClass) CONFIG.Actor.documentClass.createDocuments = () => Promise.resolve([]);
                this.logStatus("Download Only mode active: VTT Document creation suppressed.");
            }

            // 2. Install Only (No Moulinette network downloads) - Override Moulinette downloadFile helper
            const originalDownload = game.moulinette?.applications?.MoulinetteFileUtil?.downloadFile;
            if (!isDownloadActive) {
                if (game.moulinette?.applications?.MoulinetteFileUtil) {
                    game.moulinette.applications.MoulinetteFileUtil.downloadFile = () => Promise.resolve(true);
                    this.logStatus("Install Only mode active: Moulinette file downloads bypassed (using files on disk).");
                }
            }

            // 3. Monkey-patch Dialog.prompt to ignore ScenePacker reload prompts during batch
            if (this.optionSuppressScenePacker) {
                Dialog.prompt = function(options) {
                    if (options.title === game.i18n.localize('SCENE-PACKER.importer.name')) {
                        console.log("Beneos Batch Importer | Intercepted ScenePacker reload prompt successfully");
                        return Promise.resolve(); // Bypass reload dialog box
                    }
                    return originalPrompt.apply(this, arguments);
                };
            }

            // 4. Temporarily suppress the "ScenePacker.importMoulinetteComplete" Hook to silence the beneos-module install watcher popup
            if (this.optionSuppressBeneos) {
                Hooks.callAll = function(hook, ...args) {
                    if (hook === "ScenePacker.importMoulinetteComplete") {
                        console.log("Beneos Batch Importer | Suppressed VTT post-install complete hook to silence popups", args);
                        return; // Ignore completely during batch
                    }
                    return originalCallAll.apply(this, arguments);
                };

                Hooks.call = function(hook, ...args) {
                    if (hook === "ScenePacker.importMoulinetteComplete") {
                        console.log("Beneos Batch Importer | Suppressed VTT post-install complete hook to silence popups", args);
                        return; // Ignore completely during batch
                    }
                    return originalCall.apply(this, arguments);
                };

                // 5. Temporarily monkey-patch JournalSheet, DocumentSheet, and DocumentSheetV2 to completely suppress documentation/welcome sheet popups
                if (JournalSheetClass?.prototype) {
                    JournalSheetClass.prototype.render = function(force, options) {
                        console.log("Beneos Batch Importer | Suppressed welcome/documentation journal rendering during batch");
                        return this; // Do nothing
                    };
                }
                if (DocumentSheetClass?.prototype) {
                    DocumentSheetClass.prototype.render = function(force, options) {
                        console.log("Beneos Batch Importer | Suppressed DocumentSheet rendering during batch:", this.constructor.name);
                        return this; // Do nothing
                    };
                }
                if (DocumentSheetV2Class?.prototype) {
                    DocumentSheetV2Class.prototype.render = function(options, force) {
                        console.log("Beneos Batch Importer | Suppressed DocumentSheetV2 rendering during batch:", this.constructor.name);
                        return this; // Do nothing
                    };
                }
            }

            // 6. Temporarily set compatibility mode to SILENT to suppress V1 FormApplication / Dialog deprecation warnings during import
            if (CONFIG.compatibility && typeof CONST?.COMPATIBILITY_MODES?.SILENT !== "undefined") {
                CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.SILENT;
                console.log("Beneos Batch Importer | Temporarily silenced compatibility warnings during import queue");
            }

            try {
                // Dynamically import MoulinetteImporter
                const MoulinetteImporter = (await import('/modules/scene-packer/scripts/export-import/moulinette-importer.js')).default;

                for (let i = 0; i < selectedList.length; i++) {
                    if (this.isCancelled) {
                        this.logError("Import queue cancelled by user.");
                        break;
                    }
                    const pkgId = selectedList[i];
                    const pkgInfoObj = this.packages.find(p => p.id?.toString() === pkgId?.toString());
                    const pkgName = pkgInfoObj ? pkgInfoObj.name : pkgId;
                    const pkgResolution = pkgName.toLowerCase().includes("4k") || pkgName.toLowerCase().includes("uhd") || pkgName.toLowerCase().includes("ultra hd") ? "4K" : "HD";

                    // Track the active importing package ID
                    this.currentlyImportingId = pkgId;
                    
                    // Update active item name in popup progress banner
                    const progressPopup = html.find('.beneos-bi-popup-progress');
                    if (progressPopup.length > 0) {
                        progressPopup.find('.active-item-name').text(`${pkgName} (${pkgResolution})`);
                    }

                    // Dynamically apply processing class to elements immediately
                    html.find(`.beneos-bi-item[data-package-id="${pkgId}"]`).addClass('beneos-bi-item-processing').removeClass('beneos-bi-item-completed beneos-bi-item-failed');

                    let status = "success";
                    let errorMsg = "";

                    // Clean Install / Overwrite handling
                    let triggerPurge = false;
                    if (this.optionCleanInstall) {
                        this.logStatus(`[Clean Install] Clean Install option is active. Purging existing VTT folders for "${pkgName}" before importing...`, "warning");
                        triggerPurge = true;
                    } else if (this.optionAutoDetect) {
                        this.logStatus(`[Auto-Detect] Checking VTT folder integrity and assets on disk for "${pkgName}"...`);
                        const sceneFolder = game.folders.find(f => f.name === pkgName && f.type === "Scene");
                        const journalFolder = game.folders.find(f => f.name === pkgName && f.type === "JournalEntry");
                        if (!sceneFolder && !journalFolder) {
                            this.logStatus(`[Auto-Detect] No existing folders found for "${pkgName}". Proceeding with a fresh import.`);
                        } else {
                            const needsClean = await this.checkNeedsCleanInstall(pkgName);
                            if (needsClean) {
                                this.logStatus(`[Auto-Detect] Incomplete import or missing media detected for "${pkgName}". Purging folders...`, "warning");
                                triggerPurge = true;
                            } else {
                                this.logStatus(`[Auto-Detect] "${pkgName}" is already fully installed with all media assets intact. Skipping VTT folder purge.`);
                            }
                        }
                    }

                    if (triggerPurge) {
                        const folders = game.folders.filter(f => f.name === pkgName);
                        if (folders.length > 0) {
                            this.logStatus(`[Clean Install] Found ${folders.length} existing folders. Deleting recursively...`);
                            for (const folder of folders) {
                                try {
                                    await folder.delete({ deleteSubfolders: true, deleteContents: true });
                                    this.logSuccess(`[Clean Install] Safely deleted folder "${folder.name}" (${folder.type}) and all its contents.`);
                                } catch (err) {
                                    this.logError(`[Clean Install] Failed to delete folder "${folder.name}": ${err.message}`);
                                    status = "failed";
                                    errorMsg = `Folder deletion failed: ${err.message}`;
                                }
                            }
                            // Small delay to allow database deletion to flush
                            await new Promise(r => setTimeout(r, 1000));
                        } else {
                            this.logStatus(`[Clean Install] No existing folders found for "${pkgName}". Proceeding fresh.`);
                        }
                    }

                    if (status === "failed") {
                        this.failedImportingIds.add(pkgId.toString());
                        this.completedImportingIds.delete(pkgId.toString());
                        
                        this.importedCount++;
                        const pct = Math.round((this.importedCount / this.totalToImport) * 100);
                        html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                        const popup = html.find('.beneos-bi-popup-progress');
                        if (popup.length > 0) {
                            popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                            popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${this.importedCount} / ${this.totalToImport} completed)`);
                        }

                        this.importResults.push({
                            name: pkgName,
                            resolution: pkgResolution,
                            status: "failed",
                            error: errorMsg
                        });
                        this.refreshList(html);
                        continue;
                    }

                    this.logStatus(`[${i+1}/${this.totalToImport}] Querying manifest for "${pkgName}"...`);
                    
                    let packInfo = null;

                    /**
                     * =================================================================================
                     *  DEVELOPER BLUEPRINT: FUTURE DIRECT BENEOS CLOUD HOSTING
                     * =================================================================================
                     *  When transitioning away from Moulinette to direct hosting on Beneos Cloud:
                     * 
                     *  1. Swap the apiPOST call below with a native fetch to your own secure manifest endpoint:
                     *     
                     *     const response = await fetch(`${serverUrl}/api/manifest/${pkgId}`, {
                     *         headers: { "Authorization": `Bearer ${sessionId}` }
                     *     });
                     *     packInfo = await response.json();
                     * 
                     *  2. Moulinette is bypassed entirely. Instantiation of the importer shifts from the 
                     *     Moulinette-specific wrapper to the standard ScenePacker core importer:
                     *     
                     *     const importer = new ScenePacker.Importer({
                     *         packInfo: packInfo,
                     *         sceneID: '',
                     *         actorID: ''
                     *     });
                     *     
                     *  This keeps the entire UI checklist, filters, progress logging, side-by-side positioning, 
                     *  and popup silencers 100% operational with minimal architectural churn!
                     * =================================================================================
                     */

                    // Fetch pack info manifest directly from Moulinette Cloud
                    const client = game.modules.get("moulinette")?.cloudclient;
                    if (!client) {
                        this.failedImportingIds.add(pkgId.toString());
                        this.completedImportingIds.delete(pkgId.toString());
                        
                        this.importedCount++;
                        const pct = Math.round((this.importedCount / this.totalToImport) * 100);
                        html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                        const popup = html.find('.beneos-bi-popup-progress');
                        if (popup.length > 0) {
                            popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                            popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${this.importedCount} / ${this.totalToImport} completed)`);
                        }

                        this.logError(`Moulinette client missing, cannot download "${pkgName}". Skipping.`);
                        this.importResults.push({
                            name: pkgName,
                            resolution: pkgResolution,
                            status: "failed",
                            error: "Moulinette client missing"
                        });
                        this.refreshList(html);
                        continue;
                    }
                    
                    try {
                        packInfo = await client.apiPOST(`/scenepacker-assets/${pkgId}`, { 
                            scope: {
                                session: mtSession,
                                mode: "cloud-accessible"
                            }
                        });
                        if (!packInfo || typeof packInfo !== "object" || !packInfo["mtte.json"]) {
                            throw new Error("Invalid or empty manifest returned from Moulinette Cloud");
                        }
                    } catch (err) {
                        this.failedImportingIds.add(pkgId.toString());
                        this.completedImportingIds.delete(pkgId.toString());
                        
                        this.importedCount++;
                        const pct = Math.round((this.importedCount / this.totalToImport) * 100);
                        html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                        const popup = html.find('.beneos-bi-popup-progress');
                        if (popup.length > 0) {
                            popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                            popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${this.importedCount} / ${this.totalToImport} completed)`);
                        }

                        this.logError(`Failed to fetch "${pkgName}" from Moulinette Cloud: ${err.message}. Skipping.`);
                        this.importResults.push({
                            name: pkgName,
                            resolution: pkgResolution,
                            status: "failed",
                            error: err.message
                        });
                        this.refreshList(html);
                        continue;
                    }

                    this.logStatus(`Initializing download queue for "${pkgName}"...`);

                    try {
                        // Instantiate ScenePacker's Importer without sceneID limits to force absolute full-pack imports
                        const importer = new MoulinetteImporter({
                            packInfo: packInfo,
                            sceneID: '',
                            actorID: ''
                        });

                        if (this.optionSuppressScenePacker) {
                            // Completely suppress rendering of the importer window visually
                            importer.render = function() { return this; };
                            importer._render = function() { return Promise.resolve(this); };
                        } else {
                            // Render small loading display if the importer is not already closed by auto-processing
                            if (importer && importer.state !== -1) {
                                try {
                                    importer.render(true);
                                } catch (e) {
                                    console.warn("Beneos Batch Importer | Safe suppression of render error:", e);
                                }
                            }
                        }

                        // Move the Scene Packer Importer window side-by-side to the left of the Batch-Importer window
                        try {
                            if (importer && importer.setPosition && this.position && importer.element && importer.element.length > 0) {
                                const batchPos = this.position;
                                if (batchPos && typeof batchPos.left === 'number') {
                                    const importerWidth = importer.position?.width || 560;
                                    const targetLeft = Math.max(20, batchPos.left - importerWidth - 20);
                                    importer.setPosition({
                                        left: targetLeft,
                                        top: batchPos.top || 100
                                    });
                                }
                            }
                        } catch (e) {
                            console.warn("Beneos Batch Importer | Failed to position Scene Packer window side-by-side:", e);
                        }

                        // Execute procedural process pipeline
                        if (importer && typeof importer.process === "function") {
                            await importer.process();
                        }

                        // Safely close the temporary ScenePacker window
                        try {
                            if (importer && typeof importer.close === "function") {
                                importer.close();
                            }
                        } catch (e) {
                            console.warn("Beneos Batch Importer | Safe suppression of close error:", e);
                        }

                        this.completedImportingIds.add(pkgId.toString());
                        this.failedImportingIds.delete(pkgId.toString());

                        this.importedCount++;
                        const pct = Math.round((this.importedCount / this.totalToImport) * 100);
                        html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                        
                        // Update popup progress elements
                        const popup = html.find('.beneos-bi-popup-progress');
                        if (popup.length > 0) {
                            popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                            popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${this.importedCount} / ${this.totalToImport} completed)`);
                        }
                        
                        // Record successful session actions to bypass naming/indexing lags
                        if (isDownloadActive) {
                            this.downloadedPackagesSession.add(this.cleanSessionKey(pkgId));
                            this.downloadedPackagesSession.add(this.cleanSessionKey(pkgName));
                        }
                        if (isInstallActive) {
                            this.installedPackagesSession.add(this.cleanSessionKey(pkgName));
                        }

                        this.logSuccess(`Finished importing "${pkgName}" successfully!`);

                        this.importResults.push({
                            name: pkgName,
                            resolution: pkgResolution,
                            status: "success",
                            error: ""
                        });

                        // Instantly refresh the UI list to reflect status changes in real-time
                        this.refreshList(html);
                    } catch (err) {
                        this.failedImportingIds.add(pkgId.toString());
                        this.completedImportingIds.delete(pkgId.toString());

                        this.importedCount++;
                        const pct = Math.round((this.importedCount / this.totalToImport) * 100);
                        html.find('.beneos-bi-progress-bar').css('width', `${pct}%`);
                        
                        // Update popup progress elements
                        const popup = html.find('.beneos-bi-popup-progress');
                        if (popup.length > 0) {
                            popup.find('.beneos-bi-popup-progress-bar').css('width', `${pct}%`);
                            popup.find('.beneos-bi-popup-progress-text').text(`${pct}% (${this.importedCount} / ${this.totalToImport} completed)`);
                        }

                        this.logError(`Download process failed for "${pkgName}": ${err.message}`);
                        this.importResults.push({
                            name: pkgName,
                            resolution: pkgResolution,
                            status: "failed",
                            error: err.message
                        });
                        this.refreshList(html);
                    }

                    // Clear the status caches after processing each package so the UI reflects the new state instantly
                    this.installStatusCache?.clear();
                    this.downloadStatusCache?.clear();

                    // Increment session count
                    this.importedSinceReload++;

                    // Save session state to sessionStorage in case of crash/reload
                    const remainingIds = selectedList.slice(i + 1);
                    const stateToSave = {
                        viewMode: this.viewMode,
                        filterBiome: this.filterBiome,
                        filterBrightness: this.filterBrightness,
                        filterGrid: this.filterGrid,
                        filterType: this.filterType,
                        filterCampaign: this.filterCampaign,
                        filterRelease: this.filterRelease,
                        filterResolution: this.filterResolution,
                        filterSubscribed: this.filterSubscribed,
                        showHD: this.showHD,
                        show4K: this.show4K,
                        showSubscribedOnly: this.showSubscribedOnly,
                        selectedIds: Array.from(this.selectedPackages),
                        remainingIds: remainingIds,
                        importResults: this.importResults,
                        importedCount: this.importedCount,
                        totalToImport: this.totalToImport,
                        optionCleanInstall: this.optionCleanInstall,
                        optionAutoDetect: this.optionAutoDetect,
                        optionDownload: this.optionDownload,
                        optionInstall: this.optionInstall,
                        optionSuppressScenePacker: this.optionSuppressScenePacker,
                        optionSuppressBeneos: this.optionSuppressBeneos,
                        optionShowInfoPanel: this.optionShowInfoPanel
                    };
                    sessionStorage.setItem("beneos-batch-importer-resume-state", JSON.stringify(stateToSave));

                    // Check memory reload limit (every 8 packages)
                    if (this.importedSinceReload >= 8 && remainingIds.length > 0) {
                        this.logStatus("--------------------------------------------------------------------------------", "info");
                        this.logStatus("[V8 Heap Guard] To prevent WebGL/Chromium memory crash, VTT will now reload.", "info");
                        this.logStatus("Queue state saved. Simply click the Batch Importer macro to resume instantly!", "success");
                        this.logStatus("--------------------------------------------------------------------------------", "info");
                        
                        // Briefly wait so they can read the logs, then reload
                        await new Promise(r => setTimeout(r, 4500));
                        window.location.reload();
                        return; // Stop execution
                    }
                }

                this.logSuccess("Batch import processing completed.");
                sessionStorage.removeItem("beneos-batch-importer-resume-state");
            } catch (err) {
                console.error("Beneos Batch Importer | Batch Loop Error:", err);
                this.logError(`A critical error occurred: ${err.message}`);
            } finally {
                // Fade out the popup progress banner
                const popup = html.find('.beneos-bi-popup-progress');
                if (popup.length > 0) {
                    popup.fadeOut(400);
                }
                
                // Clear active processing entity class
                this.currentlyImportingId = null;
                html.find('.beneos-bi-item-processing').removeClass('beneos-bi-item-processing');

                // Restore standard behaviors
                Dialog.prompt = originalPrompt;
                Hooks.callAll = originalCallAll;
                Hooks.call = originalCall;
                if (JournalSheetClass?.prototype && originalJournalRender) {
                    JournalSheetClass.prototype.render = originalJournalRender;
                }
                if (DocumentSheetClass?.prototype && originalDocumentSheetRender) {
                    DocumentSheetClass.prototype.render = originalDocumentSheetRender;
                }
                if (DocumentSheetV2Class?.prototype && originalDocumentSheetV2Render) {
                    DocumentSheetV2Class.prototype.render = originalDocumentSheetV2Render;
                }
                
                // Restore create documents
                Folder.createDocuments = originalCreateFolders;
                CONFIG.Scene.documentClass.createDocuments = originalCreateScenes;
                CONFIG.JournalEntry.documentClass.createDocuments = originalCreateJournals;
                if (originalCreatePlaylists && CONFIG.Playlist?.documentClass) CONFIG.Playlist.documentClass.createDocuments = originalCreatePlaylists;
                if (originalCreateActors && CONFIG.Actor?.documentClass) CONFIG.Actor.documentClass.createDocuments = originalCreateActors;
                
                // Restore moulinette download helper
                if (originalDownload && game.moulinette?.applications?.MoulinetteFileUtil) {
                    game.moulinette.applications.MoulinetteFileUtil.downloadFile = originalDownload;
                }

                if (originalCompatMode !== undefined && CONFIG.compatibility) {
                    CONFIG.compatibility.mode = originalCompatMode;
                    console.log("Beneos Batch Importer | Restored original compatibility warning settings");
                }

                this.isImporting = false;
                
                // Re-enable UI
                html.find('input, select, button').prop('disabled', false);
                html.find('.beneos-bi-view-btn, .beneos-bi-bulk-dropdown-trigger, .beneos-bi-card-btn, .action-help, .action-retry').css('pointer-events', 'auto').css('opacity', '1');
                if (!this.isLinked) {
                    html.find('.beneos-bi-check-hd, .beneos-bi-check-4k, .beneos-bi-check-subscribed, .beneos-bi-check-clean, .beneos-bi-check-autodetect, .beneos-bi-check-download, .beneos-bi-check-install').prop('disabled', true);
                }

                const wasCancelled = this.isCancelled;
                this.isCancelled = false;

                // Open the main "Beneos Documentation" journal sheet exactly ONCE at the end of the entire batch run
                if (isInstallActive && !this.optionSuppressBeneos) {
                    try {
                        const docJournal = game.journal.find(j => j.name.toLowerCase().includes("beneos documentation"));
                        if (docJournal?.sheet) {
                            docJournal.sheet.render(true);
                            console.log("Beneos Batch Importer | Opened Beneos Documentation journal sheet once at the end of the batch run");
                        }
                    } catch (e) {
                        console.warn("Beneos Batch Importer | Failed to open welcome journal at the end:", e);
                    }
                }

                // If the queue completely finished, clear the session resume state
                if (this.importedCount >= this.totalToImport) {
                    sessionStorage.removeItem("beneos-batch-importer-resume-state");
                }

                // Prompt user with detailed results summary modal
                if (this.importResults.length > 0) {
                    this.showSummaryDialog(wasCancelled, isInstallActive);
                }

                // Make sure the main list is refreshed at the end of the batch run
                this.refreshList(html);
            }
        }
    }

    // Clear any saved small height to ensure the new premium default of 960px is applied at startup
    try {
        const key = "beneos-batch-importer";
        const states = game.user?.getFlag("core", "application-states") || {};
        if (states[key]) {
            const newStates = { ...states };
            delete newStates[key];
            game.user.setFlag("core", "application-states", newStates);
        }
    } catch(e) {
        console.warn("Beneos Batch Importer | Failed to clear saved window state:", e);
    }

// Assign to globalThis so external hooks/modules can instantiate it
globalThis.BeneosBatchImporterApp = BeneosBatchImporterApp;

// Auto-resume fallback (directly executed on load)

if (game.user?.isGM && sessionStorage.getItem("beneos-batch-importer-resume-state")) {
    const startResume = () => {
        console.log("Jenne Asset Manager | Active Batch Importer session detected in sessionStorage on load. Auto-resuming...");
        const app = new BeneosBatchImporterApp();
        app.render({ force: true });
    };
    if (game.ready) {
        startResume();
    } else {
        Hooks.once("ready", () => startResume());
    }
}
