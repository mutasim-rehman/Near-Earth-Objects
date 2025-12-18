import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
    import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
    import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
    import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

    // ========== CONSTANTS ==========
    const EARTH_RADIUS = 10;
    const MOON_RADIUS = EARTH_RADIUS * 0.27;
    const MOON_ORBIT_DISTANCE = EARTH_RADIUS * 3.84;
    const EARTH_TILT = 23.5 * (Math.PI / 180);
    const KM_SCALE = EARTH_RADIUS / 6371;

    // ========== GLOBAL STATE ==========
    let nasaApiKey = '';
    let fetchDuration = 7;
    let allAsteroidData = [];
    let timeMultiplier = 1.0;
    let simulationDate = new Date();
    const asteroidGroup = new THREE.Group();
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let intersectedAsteroid = null;
    let labelRenderer;
    let hideTooltipTimeout = null;

    // ========== DOM ELEMENTS ==========
    const loaderElement = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const progressBar = document.getElementById('progress');
    const apiKeyOverlay = document.getElementById('apiKeyOverlay');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const apiKeyButton = document.getElementById('apiKeyButton');
    const tooltipElement = document.getElementById('asteroidTooltip');
    const alertBanner = document.getElementById('alert-banner');
    const miniMapCanvas = document.getElementById('miniMapCanvas');
    const miniMapCtx = miniMapCanvas.getContext('2d');

    // ========== THREE.JS SETUP ==========
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(30, 15, 30);

    const renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('bg'),
        antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(labelRenderer.domElement);

    // ========== LIGHTING ==========
    const sunLight = new THREE.DirectionalLight(0xffffff, 2);
    sunLight.position.set(-150, 50, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x4040ff, 0.15);
    scene.add(ambientLight);

    // Rim light for Earth edge
    const rimLight = new THREE.DirectionalLight(0x88ccff, 0);
    rimLight.position.set(150, 30, -100);
    scene.add(rimLight);

    // ========== LOADING MANAGER ==========
    const loadingManager = new THREE.LoadingManager();
    const loadingSteps = [
        'Loading star field...',
        'Loading Earth textures...',
        'Loading atmospheric data...',
        'Initializing orbital mechanics...',
        'Connecting to NASA database...'
    ];
    let currentStep = 0;

    loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        const progress = (itemsLoaded / itemsTotal) * 100;
        progressBar.style.width = progress + '%';
        if (currentStep < loadingSteps.length) {
            loaderText.textContent = loadingSteps[currentStep];
            currentStep++;
        }
    };

    loadingManager.onLoad = async () => {
        loaderText.textContent = 'Systems Online';
        setTimeout(() => {
            loaderElement.style.opacity = '0';
            setTimeout(() => {
                loaderElement.style.display = 'none';
                apiKeyOverlay.style.display = 'flex';
                setTimeout(() => apiKeyOverlay.style.opacity = '1', 50);
            }, 500);
        }, 1000);
    };

    const textureLoader = new THREE.TextureLoader(loadingManager);

    // ========== STARFIELD ==========
    scene.background = textureLoader.load(' ');

    // Additional particle starfield for depth
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 15000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        const radius = 1000 + Math.random() * 3000;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        
        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        const colorVar = 0.8 + Math.random() * 0.2;
        colors[i] = colorVar;
        colors[i + 1] = colorVar;
        colors[i + 2] = 1;
    }

    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starsMaterial = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        transparent: true,
        opacity: 0.8
    });

    const starField = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starField);

    // ========== EARTH GROUP ==========
    const earthGroup = new THREE.Group();
    earthGroup.rotation.z = EARTH_TILT;
    scene.add(earthGroup);

    // Earth
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 256, 256);
    const earthMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('textures/8k_earth_daymap.jpg'), // Day texture
        specularMap: textureLoader.load('textures/8k_earth_specular_map.jpg'), // Defines shiny areas (water)
        normalMap: textureLoader.load('textures/8k_earth_normal_map.jpg'), // Adds surface detail (mountains)
        emissiveMap: textureLoader.load('textures/8k_earth_nightmap.jpg'), // City lights at night
        emissive: new THREE.Color(0xffffff), // Set to white to not tint the emissive map
        emissiveIntensity: 0, // This will be updated in the animate loop
        metalness: 0.1, // Earth is not very metallic
        roughness: 0.7, // Overall roughness
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthMesh.receiveShadow = true;
    earthMesh.castShadow = true;
    earthGroup.add(earthMesh);

    // Clouds
    const cloudGeometry = new THREE.SphereGeometry(EARTH_RADIUS + 0.08, 256, 256);
    const cloudMaterial = new THREE.MeshStandardMaterial({
        alphaMap: textureLoader.load('textures/8k_earth_clouds.jpg'),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloudMesh.castShadow = true;
    earthGroup.add(cloudMesh);

    // Enhanced Atmosphere
    const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS + 0,0,0);
    const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 sunDirection;
            uniform vec3 glowColor;
            varying vec3 vNormal;
            varying vec3 vPosition;
            
            void main() {
                vec3 viewDirection = normalize(-vPosition);
                float fresnelTerm = pow(1.0 - dot(viewDirection, vNormal), 4.0);
                float dayIntensity = max(0.0, dot(vNormal, sunDirection));
                float sunsetIntensity = pow(max(0.0, dot(normalize(sunDirection - vec3(0., 0.15, 0.)), vNormal)), 12.0);
                
                vec3 dayColor = glowColor * 2.0;
                vec3 sunsetColor = vec3(1.0, 0.6, 0.3);
                vec3 finalColor = mix(dayColor * dayIntensity, sunsetColor, sunsetIntensity * 0.6);
                
                gl_FragColor = vec4(finalColor, 1.0) * fresnelTerm * 1.2;
            }
        `,
        uniforms: {
            sunDirection: { value: new THREE.Vector3().copy(sunLight.position).normalize() },
            glowColor: { value: new THREE.Color(0.5, 0.7, 1.0) }
        },
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    earthGroup.add(atmosphereMesh);

    // ========== MOON ==========
    const moonOrbit = new THREE.Group();
    scene.add(moonOrbit);

    const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 128, 128);
    const moonMaterial = new THREE.MeshStandardMaterial({
        map: textureLoader.load('textures/8k_moon.jpg'),
        roughness: 1,
        metalness: 0
    });
    const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    moonMesh.position.x = MOON_ORBIT_DISTANCE;
    moonMesh.receiveShadow = true;
    moonMesh.castShadow = true;
    moonOrbit.add(moonMesh);

    // ========== ASTEROID GROUP ==========
    scene.add(asteroidGroup);

    // ========== CONTROLS ==========
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 15;
    controls.maxDistance = 5000;

    // ========== POST-PROCESSING ==========
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5, 0.4, 0.85
    );
    bloomPass.threshold = 0;
    bloomPass.strength = 0.3;
    bloomPass.radius = 0.5;
    composer.addPass(bloomPass);

    // ========== NASA API FUNCTIONS ==========
    async function loadAsteroidData() {
        if (!nasaApiKey) {
            alert('NASA API Key required');
            return;
        }

        updateHUD('loader-text', 'Fetching NEO data from NASA...');
        progressBar.style.width = '0%';
        allAsteroidData = []; // Reset data

        try {
            const today = new Date();
            const dateRanges = [];

            // Break down the fetch duration into 7-day (or smaller) chunks
            for (let i = 0; i < fetchDuration; i += 7) {
                const startDate = new Date(today);
                startDate.setDate(today.getDate() + i);

                const endDate = new Date(startDate);
                const daysInChunk = Math.min(6, fetchDuration - i - 1);
                endDate.setDate(startDate.getDate() + daysInChunk);

                const startDateStr = startDate.toISOString().split('T')[0];
                const endDateStr = endDate.toISOString().split('T')[0];
                dateRanges.push({ start: startDateStr, end: endDateStr });
            }
            
            let fetchedCount = 0;
            
            for (const range of dateRanges) {
                const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${range.start}&end_date=${range.end}&api_key=${nasaApiKey}`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (!response.ok) {
                    const errorMessage = data.error ? data.error.message : (data.error_message || 'An unknown error occurred.');
                    throw new Error(`API Error: ${response.status} - ${errorMessage}`);
                }

                const dailyData = Object.values(data.near_earth_objects).flat();
                allAsteroidData.push(...dailyData);

                fetchedCount++;
                const progress = (fetchedCount / dateRanges.length) * 100;
                progressBar.style.width = progress + '%';
                updateHUD('loader-text', `Fetching data... ${Math.round(progress)}%`);
            }

            // Remove duplicate asteroids which can appear in overlapping date ranges
            allAsteroidData = allAsteroidData.filter((asteroid, index, self) =>
                index === self.findIndex((a) => a.id === asteroid.id)
            );

            createAsteroidVisuals();
            updateStatistics();

            // Set default visibility states: master toggle off, sub-toggles on
            document.getElementById('btn-toggle-all').classList.add('inactive');
            document.getElementById('btn-toggle-safe').classList.remove('inactive');
            document.getElementById('btn-toggle-hazardous').classList.remove('inactive');
            updateAsteroidVisibility(); // Apply the default hidden state

            apiKeyOverlay.style.opacity = '0';
            setTimeout(() => apiKeyOverlay.style.display = 'none', 500);

        } catch (error) {
            console.error('Error fetching asteroid data:', error);
            alert(`Failed to load asteroid data: ${error.message}. Please check your API key and network connection.`);
        }
    }


function createAsteroidVisuals() {
    // Clear existing asteroids
    while (asteroidGroup.children.length > 0) {
        const obj = asteroidGroup.children[0];
        asteroidGroup.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    }

    const now = new Date();
    
    allAsteroidData.forEach(asteroid => {
        const isHazardous = asteroid.is_potentially_hazardous_asteroid;
        const color = isHazardous ? 0xff3333 : 0x44ff44;
        const approach = asteroid.close_approach_data[0];
        const diameterMeters = asteroid.estimated_diameter.meters.estimated_diameter_max;
        const missDistance = parseFloat(approach.miss_distance.kilometers) * KM_SCALE;
        
        const approachDate = new Date(approach.close_approach_date_full);
        const velocityKmPerHour = parseFloat(approach.relative_velocity.kilometers_per_hour);
        const velocityKmPerSecond = velocityKmPerHour / 3600;
        
        const timeUntilApproach = (approachDate - now) / 1000;
        
        const orbitRadius = Math.min(EARTH_RADIUS + missDistance, 500);
        const closestPoint = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize().multiplyScalar(orbitRadius);
        
        const direction = closestPoint.clone().normalize()
            .applyAxisAngle(
                new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
                Math.PI / 2
            );
        
        let curve;
        if (isHazardous) {
            const pathLength = Math.min(400, orbitRadius * 1.5);
            const startPoint = closestPoint.clone().add(direction.clone().multiplyScalar(pathLength));
            const endPoint = closestPoint.clone().normalize().multiplyScalar(EARTH_RADIUS);
            const controlPoint = closestPoint;
            curve = new THREE.QuadraticBezierCurve3(startPoint, controlPoint, endPoint);
        } else {
            const pathLength = 5000;
            const startPoint = closestPoint.clone().sub(direction.clone().multiplyScalar(pathLength));
            const endPoint = closestPoint.clone().add(direction.clone().multiplyScalar(pathLength));
            const controlPoint = closestPoint.clone().multiplyScalar(1.5);
            curve = new THREE.QuadraticBezierCurve3(startPoint, controlPoint, endPoint);
        }
        
        const pathPoints = curve.getPoints(isHazardous ? 100 : 50);
        const pathGeometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
        const pathMaterial = new THREE.LineBasicMaterial({
            color: isHazardous ? 0xff6666 : 0xffaa00,
            transparent: true,
            opacity: 0.4
        });
        const pathLine = new THREE.Line(pathGeometry, pathMaterial);
        asteroidGroup.add(pathLine);
        
        const asteroidSize = Math.max(0.05, Math.min(0.5, diameterMeters / 600)); 
        
        const asteroidGeometry = new THREE.IcosahedronGeometry(asteroidSize, 2);
        const asteroidMaterial = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: isHazardous ? 0.8 : 0.5,
            roughness: 0.9,
            metalness: 0.1
        });
        const asteroidMesh = new THREE.Mesh(asteroidGeometry, asteroidMaterial);
        
        const labelDiv = document.createElement('div');
        labelDiv.className = 'asteroid-label';
        labelDiv.textContent = asteroid.name.replace(/[()]/g, '');
        labelDiv.style.color = isHazardous ? '#ff6666' : '#44ff44';
        labelDiv.style.borderColor = isHazardous ? '#ff3333' : '#00ff88';

        labelDiv.addEventListener('mouseenter', (event) => {
            clearTimeout(hideTooltipTimeout);
            intersectedAsteroid = asteroidMesh;
            updateTooltip();
            // Position tooltip near cursor when entering label
            tooltipElement.style.left = event.clientX + 20 + 'px';
            tooltipElement.style.top = event.clientY + 20 + 'px';
            tooltipElement.style.display = 'block';
        });
        labelDiv.addEventListener('mousemove', (event) => {
            clearTimeout(hideTooltipTimeout);
            if (intersectedAsteroid) {
                tooltipElement.style.left = event.clientX + 20 + 'px';
                tooltipElement.style.top = event.clientY + 20 + 'px';
                tooltipElement.style.display = 'block';
            }
        });
        labelDiv.addEventListener('mouseleave', () => {
            // When cursor leaves the name tag, hide tooltip immediately
            clearTimeout(hideTooltipTimeout);
            tooltipElement.style.display = 'none';
            intersectedAsteroid = null;
        });
        
        const asteroidLabel = new CSS2DObject(labelDiv);
        asteroidLabel.position.set(0, asteroidSize + 0.8, 0);
        asteroidMesh.add(asteroidLabel);

        const volume = (4/3) * Math.PI * Math.pow(diameterMeters / 2, 3);
        const density = 2000;
        const estimatedMassKg = volume * density;
        
        const curveLength = curve.getLength();
        
        asteroidMesh.userData = {
            isAsteroid: true,
            isHazardous: isHazardous,
            curve: curve,
            curveLength: curveLength,
            pathLine: pathLine,
            name: asteroid.name,
            diameter: diameterMeters,
            velocity: velocityKmPerSecond,
            velocityDisplay: parseFloat(approach.relative_velocity.kilometers_per_hour),
            mass: estimatedMassKg,
            date: approach.close_approach_date_full,
            approachDate: approachDate,
            timeUntilApproach: timeUntilApproach,
            missDistance: parseFloat(approach.miss_distance.kilometers),
            startTime: now.getTime(),
            info: `<strong>Name:</strong> ${asteroid.name}<br>
                   <strong>Approach Date:</strong> ${approach.close_approach_date_full}<br>
                   <strong>Time Until:</strong> <span id="time-until-${asteroid.id}">Calculating...</span><br>
                   <strong>Diameter:</strong> ${diameterMeters.toFixed(2)} m<br>
                   <strong>Velocity:</strong> ${parseFloat(approach.relative_velocity.kilometers_per_hour).toLocaleString()} km/h<br>
                   <strong>Mass (Est.):</strong> ${estimatedMassKg > 1e9 ? (estimatedMassKg / 1e9).toFixed(2) + ' GT' : (estimatedMassKg / 1e6).toFixed(2) + ' MT'}<br>
                   <strong>Miss Distance:</strong> ${parseFloat(approach.miss_distance.kilometers).toLocaleString()} km<br>
                   <strong>Current Distance:</strong> <span id="current-dist-${asteroid.id}">Calculating...</span> km<br>
                   <strong>Status:</strong> <span style="color: ${isHazardous ? '#ff4444' : '#44ff44'};">${isHazardous ? 'POTENTIALLY HAZARDOUS' : 'SAFE PASSAGE'}</span>`
        };

        asteroidGroup.add(asteroidMesh);
    });
}

    // ========== HUD UPDATES ==========
    function updateStatistics() {
        const hazardousCount = allAsteroidData.filter(a => a.is_potentially_hazardous_asteroid).length;
        const safeCount = allAsteroidData.length - hazardousCount;
        
        updateHUD('tracked-objects', allAsteroidData.length);
        updateHUD('hazardous-count', hazardousCount);
        updateHUD('safe-count', safeCount);
        
        // Update threat panel
        const threatList = document.getElementById('threat-list');
        threatList.innerHTML = '';
        
        const hazardousAsteroids = allAsteroidData.filter(a => a.is_potentially_hazardous_asteroid);
        
        if (hazardousAsteroids.length > 0) {
            alertBanner.classList.add('show');
            
            hazardousAsteroids.forEach(asteroid => {
                const approach = asteroid.close_approach_data[0];
                const threatItem = document.createElement('div');
                threatItem.className = 'threat-item';
                const approachDate = new Date(approach.close_approach_date_full);
                const formattedDate = approachDate.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                threatItem.innerHTML = `
                    <strong>${asteroid.name}</strong><br>
                    <strong style="color: #ff6666;">CLOSEST APPROACH:</strong> ${formattedDate}<br>
                    Diameter: ${asteroid.estimated_diameter.meters.estimated_diameter_max.toFixed(1)} m<br>
                    Velocity: ${parseFloat(approach.relative_velocity.kilometers_per_hour).toLocaleString()} km/h<br>
                    Miss Distance: ${parseFloat(approach.miss_distance.kilometers).toLocaleString()} km
                `;
                threatList.appendChild(threatItem);
            });
        } else {
            alertBanner.classList.remove('show');
            threatList.innerHTML = '<div style="color: #44ff44; text-align: center; padding: 20px;">No immediate threats detected</div>';
        }
    }

    function updateHUD(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = value;
    }

    function updateSystemTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { hour12: false });
        updateHUD('system-time', timeString);
        
        const dateString = simulationDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        updateHUD('timeline-date', dateString);
    }

    // ========== MINI MAP ==========
    function updateMiniMap() {
        miniMapCtx.fillStyle = 'rgba(0, 20, 40, 0.5)';
        miniMapCtx.fillRect(0, 0, 200, 200);
        
        // Draw Earth
        miniMapCtx.beginPath();
        miniMapCtx.arc(100, 100, 30, 0, Math.PI * 2);
        miniMapCtx.fillStyle = '#0088ff';
        miniMapCtx.fill();
        miniMapCtx.strokeStyle = '#00ff88';
        miniMapCtx.lineWidth = 2;
        miniMapCtx.stroke();
        
        // Draw asteroids
        asteroidGroup.children.forEach(child => {
            if (child.userData.isAsteroid && child.visible) {
                const pos = child.position;
                const distance = pos.length();
                const angle = Math.atan2(pos.z, pos.x);
                
                const mapRadius = Math.min((distance / 100) * 70, 90);
                const x = 100 + Math.cos(angle) * mapRadius;
                const y = 100 + Math.sin(angle) * mapRadius;
                
                miniMapCtx.beginPath();
                miniMapCtx.arc(x, y, child.userData.isHazardous ? 3 : 2, 0, Math.PI * 2);
                miniMapCtx.fillStyle = child.userData.isHazardous ? '#ff3333' : '#44ff44';
                miniMapCtx.fill();
            }
        });
        
        // Draw camera direction
        const camAngle = Math.atan2(camera.position.z, camera.position.x);
        miniMapCtx.beginPath();
        miniMapCtx.moveTo(100, 100);
        miniMapCtx.lineTo(100 + Math.cos(camAngle) * 40, 100 + Math.sin(camAngle) * 40);
        miniMapCtx.strokeStyle = '#ffaa00';
        miniMapCtx.lineWidth = 2;
        miniMapCtx.stroke();
    }

function updateTooltip() {
    if (!intersectedAsteroid) return;
    
    const userData = intersectedAsteroid.userData;
    const currentTime = simulationDate.getTime();
    const timeUntil = userData.approachDate.getTime() - currentTime;
    
    let timeUntilStr;
    if (timeUntil < 0) {
        const timeSince = Math.abs(timeUntil);
        const days = Math.floor(timeSince / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeSince % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        timeUntilStr = `<span style="color: #888;">${days}d ${hours}h ago</span>`;
    } else {
        const days = Math.floor(timeUntil / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeUntil % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));
        timeUntilStr = `<span style="color: #ffaa00;">${days}d ${hours}h ${minutes}m</span>`;
    }
    
    const distKm = userData.currentDistance || 0;
    
    tooltipElement.style.display = 'block';
    tooltipElement.innerHTML = `<strong>Name:</strong> ${userData.name}<br>
               <strong>Approach Date:</strong> ${userData.date}<br>
               <strong>Time Until:</strong> ${timeUntilStr}<br>
               <strong>Diameter:</strong> ${userData.diameter.toFixed(2)} m<br>
               <strong>Velocity:</strong> ${userData.velocityDisplay.toLocaleString()} km/h<br>
               <strong>Mass (Est.):</strong> ${userData.mass > 1e9 ? (userData.mass / 1e9).toFixed(2) + ' GT' : (userData.mass / 1e6).toFixed(2) + ' MT'}<br>
               <strong>Miss Distance:</strong> ${userData.missDistance.toLocaleString()} km<br>
               <strong>Current Distance:</strong> ${distKm.toLocaleString(undefined, {maximumFractionDigits: 0})} km<br>
               <strong>Progress:</strong> ${(userData.progress * 100).toFixed(1)}%<br>
               <strong>Status:</strong> <span style="color: ${userData.isHazardous ? '#ff4444' : '#44ff44'};">${userData.isHazardous ? 'POTENTIALLY HAZARDOUS' : 'SAFE PASSAGE'}</span>`;
}

    // ========== MOUSE INTERACTION ==========
function handleMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    clearTimeout(hideTooltipTimeout);

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(
        asteroidGroup.children.filter(c => c.userData.isAsteroid && c.visible)
    );
    
    if (intersects.length > 0) {
        if (intersectedAsteroid !== intersects[0].object) {
            intersectedAsteroid = intersects[0].object;
            updateTooltip();
        }
        tooltipElement.style.left = event.clientX + 20 + 'px';
        tooltipElement.style.top = event.clientY + 20 + 'px';
        tooltipElement.style.display = 'block';
    } else {
        // If mouse is not over any asteroid mesh, hide the tooltip
        hideTooltipTimeout = setTimeout(() => {
            tooltipElement.style.display = 'none';
            intersectedAsteroid = null;
        }, 50);
    }
}


    // ========== LABEL VISIBILITY CHECK ==========
    function updateLabelVisibility() {
        const cameraPosition = new THREE.Vector3();
        camera.getWorldPosition(cameraPosition);

        asteroidGroup.children.forEach(child => {
            if (child.userData.isAsteroid) {
                const label = child.children[0];
                if (!child.visible) {
                    if (label) label.visible = false;
                    return;
                }

                if (label && label.isCSS2DObject) {
                    const asteroidPosition = new THREE.Vector3();
                    child.getWorldPosition(asteroidPosition);

                    const direction = new THREE.Vector3().subVectors(asteroidPosition, cameraPosition).normalize();
                    raycaster.set(cameraPosition, direction);

                    const intersects = raycaster.intersectObject(earthMesh, false);

                    if (intersects.length > 0) {
                        const distanceToAsteroid = cameraPosition.distanceTo(asteroidPosition);
                        if (intersects[0].distance < distanceToAsteroid) {
                            label.visible = false;
                        } else {
                            label.visible = true;
                        }
                    } else {
                        label.visible = true;
                    }
                }
            }
        });
    }

    // ========== VISIBILITY CONTROLS ==========
    function updateAsteroidVisibility() {
        const allVisible = !document.getElementById('btn-toggle-all').classList.contains('inactive');
        const safeVisible = !document.getElementById('btn-toggle-safe').classList.contains('inactive');
        const hazardousVisible = !document.getElementById('btn-toggle-hazardous').classList.contains('inactive');

        asteroidGroup.children.forEach(child => {
            if (child.userData.isAsteroid) {
                let shouldBeVisible = false;
                if (allVisible) {
                    if (child.userData.isHazardous && hazardousVisible) {
                        shouldBeVisible = true;
                    } else if (!child.userData.isHazardous && safeVisible) {
                        shouldBeVisible = true;
                    }
                }
                child.visible = shouldBeVisible;
                child.userData.pathLine.visible = shouldBeVisible;
            }
        });
    }

    // ========== ANIMATION LOOP ==========
    const clock = new THREE.Clock();
    let lastDateUpdate = 0;

    function animate() {
        requestAnimationFrame(animate);
        
        const delta = clock.getDelta();
        const elapsedTime = clock.getElapsedTime();

        // Advance simulation time smoothly
        simulationDate.setMilliseconds(simulationDate.getMilliseconds() + delta * 1000 * timeMultiplier);
        
        // Update date display once per second
        if (elapsedTime - lastDateUpdate > 1) {
            updateSystemTime();
            lastDateUpdate = elapsedTime;
        }
        
        const now = simulationDate;
        const hours = now.getUTCHours();
        const minutes = now.getUTCMinutes();
        const seconds = now.getUTCSeconds();
        
        // Calculate sun position based on UTC time
        const sunAngle = ((hours * 60 + minutes) * 60 + seconds) / 86400 * Math.PI * 2 - Math.PI;
        sunLight.position.set(
            Math.cos(sunAngle) * 150,
            0, // Keep sun in the equatorial plane for realistic day/night cycle
            Math.sin(sunAngle) * 150
        );
        
        // Update Earth rotation based on real time
        const earthRotation = ((hours * 60 + minutes) * 60 + seconds) / 86400 * Math.PI * 2;
        earthMesh.rotation.y = earthRotation;
        cloudMesh.rotation.y = earthRotation * 1.05;
        
        // Update Moon position based on real time (simplified)
        const moonPhase = (now.getDate() / 30) * Math.PI * 2;
        moonOrbit.rotation.y = moonPhase;
        
        // Update atmosphere shader
        atmosphereMaterial.uniforms.sunDirection.value.copy(sunLight.position).normalize();
        
        // Update night lights based on sun position
        const sunDirection = new THREE.Vector3().copy(sunLight.position).normalize();
        const cameraToEarth = new THREE.Vector3().subVectors(earthMesh.position, camera.position).normalize();
        const dot = sunDirection.dot(cameraToEarth);
        const intensity = Math.pow(Math.max(0, dot), 2.5) * 1.5;
        earthMaterial.emissiveIntensity = intensity;
        
// Animate asteroids with real-time physics
asteroidGroup.children.forEach(child => {
    if (child.userData.isAsteroid) {
        const currentTime = simulationDate.getTime();
        const startTime = child.userData.startTime;
        const approachTime = child.userData.approachDate.getTime();
        
        // Calculate time-based progress (0 to 1, where 0.5 is closest approach)
        const totalTime = Math.abs(approachTime - startTime) * 2; // Total orbital period
        const elapsedTimeSinceStart = currentTime - startTime;
        let progress = 0.5 - (approachTime - currentTime) / totalTime;
        
        // Clamp progress between 0 and 1
        progress = Math.max(0, Math.min(1, progress));
        
        // Update position along curve
        child.position.copy(child.userData.curve.getPointAt(progress));
        
        // Calculate actual distance from Earth for display
        const distanceFromEarth = child.position.length();
        const distanceKm = distanceFromEarth / KM_SCALE;
        
        // Update userData with current position for info display
        child.userData.currentDistance = distanceKm;
        child.userData.progress = progress;
        
        // Rotate asteroid based on its actual velocity
        const rotationSpeed = child.userData.velocity * 0.01;
        child.rotation.x += delta * rotationSpeed;
        child.rotation.y += delta * rotationSpeed * 0.7;
        
        // Update asteroid glow intensity based on proximity to Earth
        const proximityFactor = 1 - Math.min(distanceFromEarth / 200, 1);
        if (child.userData.isHazardous) {
            child.material.emissiveIntensity = 0.5 + (proximityFactor * 0.5);
        }
        
        // Create warning pulse for very close asteroids
        if (child.userData.isHazardous && distanceKm < 100000) {
            const pulse = Math.sin(elapsedTime * 5) * 0.3 + 0.7;
            child.material.emissiveIntensity = pulse;
        }
    }
});
        
        // Update label visibility
        updateLabelVisibility();
        
        // Update mini map
        updateMiniMap();
        
        controls.update();
        composer.render();
        if (labelRenderer) labelRenderer.render(scene, camera);
    }

    // ========== EVENT LISTENERS ==========
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (labelRenderer) labelRenderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('mousemove', handleMouseMove);
    
    // API Key Overlay Listeners
    document.querySelectorAll('.duration-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fetchDuration = parseInt(btn.dataset.days);
        });
    });

    apiKeyButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            nasaApiKey = key;
            loadAsteroidData();
        } else {
            alert('Please enter a valid NASA API key');
        }
    });

    // Visibility Controls
    document.getElementById('btn-toggle-all').addEventListener('click', function() {
        this.classList.toggle('inactive');
        updateAsteroidVisibility();
    });

    document.getElementById('btn-toggle-safe').addEventListener('click', function() {
        this.classList.toggle('inactive');
        updateAsteroidVisibility();
    });

    document.getElementById('btn-toggle-hazardous').addEventListener('click', function() {
        this.classList.toggle('inactive');
        updateAsteroidVisibility();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        switch(e.key) {
            case ' ':
                e.preventDefault();
                timeMultiplier = timeMultiplier === 0 ? 1 : 0;
                const statusElement = document.getElementById('sim-status');
                if (timeMultiplier === 0) {
                    updateHUD('sim-status', 'PAUSED');
                    statusElement.style.color = '#ff6666';
                } else {
                    updateHUD('sim-status', 'ACTIVE');
                    statusElement.style.color = '#fff';
                }
                break;
            case 'r':
                camera.position.set(30, 15, 30);
                controls.target.set(0, 0, 0);
                break;
        }
    });

    // ========== START ==========
    updateSystemTime();
    animate();
