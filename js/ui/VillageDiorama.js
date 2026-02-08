/**
 * VillageDiorama.js - 3D 村庄微缩沙盘
 * Low-Poly 风格的 3D 村庄模型，实时反映村庄建设、天气、季节和昼夜状态
 * 
 * 功能：
 * - 程序化生成 Low-Poly 建筑模型（跟随游戏建设状态）
 * - 村民小人在建筑间行走（跟随当前任务）
 * - 天气粒子效果（雨/雪）
 * - 季节主题色变化（地面、树木、天空）
 * - 昼夜光照循环（跟随游戏时间）
 * - 鼠标拖拽旋转 + 滚轮缩放
 */

import * as THREE from 'three';

// ===== 季节调色板 =====
const PALETTES = {
    spring: {
        ground: 0x7ec850, groundEdge: 0x5a9e35, path: 0xd7ccc8,
        tree: 0x5da83a, accent: 0xffb7c5, sky: 0xc8e6ff,
    },
    summer: {
        ground: 0x4a8c2a, groundEdge: 0x3a7020, path: 0xe0d5c0,
        tree: 0x2e7d32, accent: 0xfdd835, sky: 0x87ceeb,
    },
    autumn: {
        ground: 0xb5a642, groundEdge: 0x8a7e30, path: 0xd4b896,
        tree: 0xd4652a, accent: 0xff8f00, sky: 0xe0c8a0,
    },
    winter: {
        ground: 0xdfe6e9, groundEdge: 0xb0bec5, path: 0xeeeeee,
        tree: 0x8d6e63, accent: 0xeceff1, sky: 0xb0c4d8,
    },
};

// ===== 建筑放置位置 [x, z] =====
const SLOTS = {
    house:      [[-3.5, 2], [3.5, 2], [-3.5, -2], [3.5, -2]],
    // 预留10块农田位置（2行5列布局）
    farmPlot:   [
        [-4, 5.5], [-2, 5.5], [0, 5.5], [2, 5.5], [4, 5.5],   // 第一行
        [-4, 8],   [-2, 8],   [0, 8],   [2, 8],   [4, 8]      // 第二行
    ],
    lumberYard: [[7, 4]],
    quarry:     [[-7, 4]],
    fishPond:   [[-6, -5]],   // 左下角
    mill:       [[-4, -4.5]],
    bakery:     [[4, -4.5]],
    well:       [[0, 1.5]],
    warehouse:  [[7, -2], [-7, -2], [7, 0.5]],  // 最多3次升级
    market:     [[6, -5.5]],  // 市场在右下角
};

// ===== 邻村位置（地图边缘外围）=====
const NEIGHBOR_VILLAGES = [
    { pos: [18, 0], name: '东林村', color: 0x81c784 },      // 东边
    { pos: [-18, 5], name: '西山村', color: 0x64b5f6 },     // 西北边
    { pos: [0, -18], name: '南溪村', color: 0xffb74d },     // 南边
];

// ===== 村民动作 → 目标建筑映射 =====
const ACTION_TARGET = {
    '种植': 'farmPlot', '浇水': 'farmPlot', '施肥': 'farmPlot', '收获': 'farmPlot', '除虫': 'farmPlot',
    '伐木': 'lumberYard', '采石': 'quarry',
    '加工': 'mill', '磨坊': 'mill', '面包': 'bakery',
    '交易': 'market', '市场': 'market', '买': 'market', '卖': 'market',
    '仓库': 'warehouse', '存储': 'warehouse',
    '休息': 'house', '吃饭': 'house', '睡觉': 'house',
    '钓鱼': 'fishPond',
};

// ===== 村民颜色 =====
const VILLAGER_COLORS = [0x42a5f5, 0x66bb6a, 0xffa726, 0xef5350];

export class VillageDiorama {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // Three.js 核心
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.container = null;
        this.clock = new THREE.Clock();

        // 场景对象
        this.groundMesh = null;
        this.groundEdgeMesh = null;
        this.pathMeshes = [];
        this.buildingMap = new Map();   // key → THREE.Group
        this.villagerMap = new Map();   // villagerId → { mesh, tx, tz, ... }
        this.trees = [];
        this.weatherParticles = null;
        this.flagMesh = null;
        this.sunMesh = null;
        this.moonMesh = null;
        this.stars = null;
        this.clouds = [];
        this.flowers = [];
        this.rocks = [];
        this.neighborVillages = [];  // 邻村模型

        // 灯光
        this.ambientLight = null;
        this.sunLight = null;
        this.hemiLight = null;

        // 相机控制
        this.camAngle = 0.6;
        this.camElev = 0.45;
        this.camDist = 20;
        this.camTarget = new THREE.Vector3(0, 0, 1);
        this.dragging = false;
        this.lastMouse = { x: 0, y: 0 };
        this.autoRotate = true;

        // 动画
        this.animFrame = null;
        this.isActive = false;
        this.isInited = false;
        this.elapsed = 0;

        // 昼夜渐变过渡系统
        this._lighting = {
            // 当前值
            sunIntensity: 1.2,
            ambIntensity: 0.55,
            sunColor: new THREE.Color(0xffeedd),
            skyColor: new THREE.Color(0x87ceeb),
            fogColor: new THREE.Color(0x87ceeb),
            exposure: 1.0,
            // 目标值
            targetSunIntensity: 1.2,
            targetAmbIntensity: 0.55,
            targetSunColor: new THREE.Color(0xffeedd),
            targetSkyColor: new THREE.Color(0x87ceeb),
            targetFogColor: new THREE.Color(0x87ceeb),
            targetExposure: 1.0,
        };
        this._transitionSpeed = 2.0; // 过渡速度（每秒）

        // 变化检测缓存
        this._cSeason = null;
        this._cHour = -1;
        this._cWeather = null;
        this._cBldKey = '';
        this._cVilCnt = -1;
    }

    // ===== 面板生命周期（由 UIManager 调用）=====

    onActivate() {
        if (!this.isInited) this._init();
        this.isActive = true;
        this._resize();
        // 强制重置缓存，确保首次切换到沙盘时完整同步
        this._cBldKey = '__force_sync__';
        this._cVilCnt = -1;
        this._syncAll();
        this._startLoop();
    }

    onDeactivate() {
        this.isActive = false;
        this._stopLoop();
    }

    update() {
        if (!this.isActive || !this.isInited) return;
        this._syncAll();
    }

    // ===== 初始化 =====

    _init() {
        this.container = document.getElementById('diorama-canvas-wrap');
        if (!this.container) return;

        try {
            this._initRenderer();
            this._initCamera();
            this._initLights();
            this._initGround();
            this._initDecorations();
            this._initControls();
            this.isInited = true;
            console.log('[Diorama] ✅ 3D 村庄沙盘已就绪');
        } catch (err) {
            console.error('[Diorama] 初始化失败:', err);
            this.container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:14px;">
                ⚠️ 3D 沙盘加载失败（${err.message}），请刷新重试</div>`;
        }
    }

    _initRenderer() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(PALETTES.spring.sky);
        this.scene.fog = new THREE.FogExp2(PALETTES.spring.sky, 0.012);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);
    }

    _initCamera() {
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
        this._updateCamPos();
    }

    _initLights() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(this.ambientLight);

        this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a7c10, 0.35);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
        this.sunLight.position.set(8, 14, 6);
        this.sunLight.castShadow = true;
        const s = this.sunLight.shadow;
        s.mapSize.set(1024, 1024);
        s.camera.near = 0.5;
        s.camera.far = 50;
        s.camera.left = s.camera.bottom = -16;
        s.camera.right = s.camera.top = 16;
        s.bias = -0.001;
        this.scene.add(this.sunLight);
    }

    _initGround() {
        // 草地
        const gGeo = new THREE.CircleGeometry(13, 48);
        const gMat = new THREE.MeshLambertMaterial({ color: PALETTES.spring.ground });
        this.groundMesh = new THREE.Mesh(gGeo, gMat);
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        // 边缘
        const eGeo = new THREE.RingGeometry(12.8, 13.5, 48);
        const eMat = new THREE.MeshLambertMaterial({ color: PALETTES.spring.groundEdge, side: THREE.DoubleSide });
        this.groundEdgeMesh = new THREE.Mesh(eGeo, eMat);
        this.groundEdgeMesh.rotation.x = -Math.PI / 2;
        this.groundEdgeMesh.position.y = -0.01;
        this.scene.add(this.groundEdgeMesh);

        // 底座
        const bGeo = new THREE.CylinderGeometry(13.5, 14, 0.6, 48);
        const bMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
        const base = new THREE.Mesh(bGeo, bMat);
        base.position.y = -0.35;
        this.scene.add(base);
    }

    _initDecorations() {
        this._createPaths();
        this._createFlag();
        this._createSunMoon();
        this._createClouds();
        this._createFlowersAndRocks();
        this._createNeighborVillages();
        this._generateTrees();
    }

    _createSunMoon() {
        // 太阳
        const sunGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.sunMesh.position.set(20, 18, -15);
        this.scene.add(this.sunMesh);

        // 太阳光晕
        const glowGeo = new THREE.SphereGeometry(1.8, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({ 
            color: 0xffee88, 
            transparent: true, 
            opacity: 0.3 
        });
        const sunGlow = new THREE.Mesh(glowGeo, glowMat);
        this.sunMesh.add(sunGlow);

        // 月亮
        const moonGeo = new THREE.SphereGeometry(0.9, 16, 16);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xf5f5dc });
        this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
        this.moonMesh.position.set(-18, 16, 12);
        this.moonMesh.visible = false;
        this.scene.add(this.moonMesh);

        // 月亮光晕
        const moonGlowGeo = new THREE.SphereGeometry(1.3, 16, 16);
        const moonGlowMat = new THREE.MeshBasicMaterial({ 
            color: 0xe8e8d0, 
            transparent: true, 
            opacity: 0.2 
        });
        const moonGlow = new THREE.Mesh(moonGlowGeo, moonGlowMat);
        this.moonMesh.add(moonGlow);

        // 月亮上的坑纹理
        const craterMat = new THREE.MeshBasicMaterial({ color: 0xddddc8 });
        for (let i = 0; i < 3; i++) {
            const crater = new THREE.Mesh(new THREE.CircleGeometry(0.15 + Math.random() * 0.1, 8), craterMat);
            crater.position.set(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                0.9
            );
            this.moonMesh.add(crater);
        }

        // 星星
        const starCount = 80;
        const starPositions = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);
        
        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.4; // 只在天空上半部分
            const r = 40 + Math.random() * 20;
            
            starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            starPositions[i * 3 + 1] = r * Math.cos(phi) + 5; // 确保在地平线以上
            starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            starSizes[i] = 0.5 + Math.random() * 1.5;
        }

        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
        
        const starMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.4,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true
        });
        
        this.stars = new THREE.Points(starGeo, starMat);
        this.stars.visible = false; // 默认白天不可见
        this.scene.add(this.stars);
    }

    _createClouds() {
        this.clouds.forEach(c => this.scene.remove(c));
        this.clouds = [];

        const cloudMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, 
            transparent: true, 
            opacity: 0.85 
        });

        for (let i = 0; i < 6; i++) {
            const cloud = new THREE.Group();
            // 云朵由多个球体组成
            const baseCount = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < baseCount; j++) {
                const size = 0.6 + Math.random() * 0.8;
                const puff = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), cloudMat);
                puff.position.set(
                    j * 0.8 - baseCount * 0.4,
                    (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.3
                );
                cloud.add(puff);
            }

            // 随机位置在天空中
            const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
            const radius = 18 + Math.random() * 8;
            cloud.position.set(
                Math.cos(angle) * radius,
                12 + Math.random() * 6,
                Math.sin(angle) * radius
            );
            cloud.scale.setScalar(0.8 + Math.random() * 0.4);
            cloud.userData.angle = angle;
            cloud.userData.radius = radius;
            cloud.userData.speed = 0.02 + Math.random() * 0.02;

            this.scene.add(cloud);
            this.clouds.push(cloud);
        }
    }

    _createFlowersAndRocks() {
        // 清除旧的
        this.flowers.forEach(f => this.scene.remove(f));
        this.rocks.forEach(r => this.scene.remove(r));
        this.flowers = [];
        this.rocks = [];

        const palette = PALETTES[this.state.season] || PALETTES.spring;
        const isWinter = this.state.season === 'winter';

        // 小石头
        const rockMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
        for (let i = 0; i < 15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * 9;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            // 避开建筑区域
            if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;
            if (Math.abs(z - 6.5) < 2.5 && Math.abs(x) < 4) continue;

            const size = 0.08 + Math.random() * 0.12;
            const rock = new THREE.Mesh(
                new THREE.DodecahedronGeometry(size, 0),
                rockMat
            );
            rock.position.set(x, size * 0.3, z);
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            this.scene.add(rock);
            this.rocks.push(rock);
        }

        // 花朵（非冬天）
        if (!isWinter) {
            const flowerColors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xc9b1ff];
            for (let i = 0; i < 25; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 4 + Math.random() * 8;
                const x = Math.cos(angle) * dist;
                const z = Math.sin(angle) * dist;

                // 避开路径和建筑
                if (Math.abs(x) < 0.8 || Math.abs(z) < 0.8) continue;
                if (Math.abs(z - 6.5) < 2.5 && Math.abs(x) < 4) continue;

                const flower = new THREE.Group();
                const color = flowerColors[Math.floor(Math.random() * flowerColors.length)];
                
                // 花茎
                const stem = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.015, 0.015, 0.15, 4),
                    new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
                );
                stem.position.y = 0.075;
                flower.add(stem);

                // 花朵
                const petal = new THREE.Mesh(
                    new THREE.SphereGeometry(0.06, 6, 6),
                    new THREE.MeshLambertMaterial({ color })
                );
                petal.position.y = 0.16;
                flower.add(petal);

                flower.position.set(x, 0, z);
                flower.scale.setScalar(0.8 + Math.random() * 0.4);
                this.scene.add(flower);
                this.flowers.push(flower);
            }
        }
    }

    _createNeighborVillages() {
        // 清除旧的邻村
        this.neighborVillages.forEach(v => this.scene.remove(v));
        this.neighborVillages = [];

        NEIGHBOR_VILLAGES.forEach((nv, i) => {
            const village = this._mkNeighborVillage(nv.color, nv.name);
            village.position.set(nv.pos[0], 0, nv.pos[1]);
            // 面向村庄中心
            village.rotation.y = Math.atan2(-nv.pos[0], -nv.pos[1]);
            this.scene.add(village);
            this.neighborVillages.push(village);
        });
    }

    /**
     * 创建邻村模型（远景简化版）
     */
    _mkNeighborVillage(accentColor, name) {
        const g = new THREE.Group();
        const palette = PALETTES[this.state.season] || PALETTES.spring;

        // 小型草地平台
        const platform = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5, 2.8, 0.2, 12),
            new THREE.MeshLambertMaterial({ color: palette.ground })
        );
        platform.position.y = -0.1;
        platform.receiveShadow = true;
        g.add(platform);

        // 主建筑（村庄标志性建筑）
        const mainBuilding = new THREE.Group();
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xd7ccc8 });
        const roofMat = new THREE.MeshLambertMaterial({ color: accentColor });

        // 主屋
        const mainWall = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.8), wallMat);
        mainWall.position.y = 0.35;
        mainWall.castShadow = true;
        mainBuilding.add(mainWall);

        const mainRoof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.4, 4), roofMat);
        mainRoof.position.y = 0.9;
        mainRoof.rotation.y = Math.PI / 4;
        mainRoof.castShadow = true;
        mainBuilding.add(mainRoof);

        mainBuilding.position.set(0, 0, 0);
        g.add(mainBuilding);

        // 小房子（2-3栋）
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
            const dist = 1.2 + Math.random() * 0.3;
            const house = new THREE.Group();

            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.35, 0.35),
                new THREE.MeshLambertMaterial({ color: 0xbcaaa4 })
            );
            wall.position.y = 0.175;
            wall.castShadow = true;
            house.add(wall);

            const roof = new THREE.Mesh(
                new THREE.ConeGeometry(0.3, 0.22, 4),
                new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
            );
            roof.position.y = 0.46;
            roof.rotation.y = Math.PI / 4;
            house.add(roof);

            house.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
            house.rotation.y = angle + Math.PI;
            g.add(house);
        }

        // 小树（3-4棵）
        const treeMat = new THREE.MeshLambertMaterial({ color: palette.tree });
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6d4c2e });
        for (let i = 0; i < 4; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 1.5 + Math.random() * 0.8;
            const tree = new THREE.Group();

            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 4), trunkMat);
            trunk.position.y = 0.15;
            tree.add(trunk);

            const foliage = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 5), treeMat);
            foliage.position.y = 0.45;
            tree.add(foliage);

            tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
            g.add(tree);
        }

        // 村庄名称标牌
        const signPost = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4),
            new THREE.MeshLambertMaterial({ color: 0x5d4037 })
        );
        signPost.position.set(1.8, 0.25, 0);
        g.add(signPost);

        const sign = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.2, 0.02),
            new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
        );
        sign.position.set(1.8, 0.55, 0);
        g.add(sign);

        // 连接道路（指向主村庄中心）
        const roadMat = new THREE.MeshLambertMaterial({ color: palette.path });
        const road = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 4), roadMat);
        road.position.set(0, 0.005, 3.5);  // 向前延伸（朝向中心村庄）
        g.add(road);

        g.userData.name = name;
        return g;
    }

    _createPaths() {
        this.pathMeshes.forEach(m => this.scene.remove(m));
        this.pathMeshes = [];
        const mat = new THREE.MeshLambertMaterial({ color: PALETTES.spring.path });
        const edgeMat = new THREE.MeshLambertMaterial({ color: 0x8d8d8d });

        // 十字路 - 南北向
        const ns = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 16), mat);
        ns.position.set(0, 0.01, 1);
        ns.receiveShadow = true;
        this.scene.add(ns);
        this.pathMeshes.push(ns);

        // 十字路 - 东西向
        const ew = new THREE.Mesh(new THREE.BoxGeometry(16, 0.02, 0.6), mat.clone());
        ew.position.set(0, 0.01, 0);
        ew.receiveShadow = true;
        this.scene.add(ew);
        this.pathMeshes.push(ew);

        // 道路边缘石子装饰
        const stoneMat = new THREE.MeshLambertMaterial({ color: 0x757575 });
        for (let i = 0; i < 40; i++) {
            const onNS = Math.random() > 0.5;
            const size = 0.04 + Math.random() * 0.05;
            const stone = new THREE.Mesh(
                new THREE.DodecahedronGeometry(size, 0),
                stoneMat
            );
            if (onNS) {
                const side = Math.random() > 0.5 ? 0.35 : -0.35;
                stone.position.set(side, size * 0.3, (Math.random() - 0.5) * 14);
            } else {
                const side = Math.random() > 0.5 ? 0.35 : -0.35;
                stone.position.set((Math.random() - 0.5) * 14, size * 0.3, side);
            }
            stone.rotation.set(Math.random(), Math.random(), Math.random());
            this.scene.add(stone);
            this.pathMeshes.push(stone);
        }

        // 中心广场
        const plaza = new THREE.Mesh(
            new THREE.CircleGeometry(1.2, 16),
            new THREE.MeshLambertMaterial({ color: 0xbcaaa4 })
        );
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.015;
        this.scene.add(plaza);
        this.pathMeshes.push(plaza);
    }

    _createFlag() {
        const g = new THREE.Group();
        
        // 旗杆底座
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
        const base1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.12, 8), baseMat);
        base1.position.y = 0.06;
        g.add(base1);
        const base2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.08, 8), baseMat);
        base2.position.y = 0.16;
        g.add(base2);

        // 旗杆
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.04, 2.4, 8),
            new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
        );
        pole.position.y = 1.4;
        g.add(pole);

        // 杆顶装饰
        const top = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 8),
            new THREE.MeshLambertMaterial({ color: 0xffd700 })
        );
        top.position.y = 2.65;
        g.add(top);

        // 五星红旗
        const flagGroup = new THREE.Group();
        
        // 红色旗面
        this.flagMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 0.43, 0.015),
            new THREE.MeshLambertMaterial({ color: 0xde2910, side: THREE.DoubleSide })
        );
        flagGroup.add(this.flagMesh);

        // 五颗黄星
        const starMat = new THREE.MeshBasicMaterial({ color: 0xffde00 });
        
        // 创建五角星形状的函数
        const createStar = (outerR, innerR) => {
            const shape = new THREE.Shape();
            const points = 5;
            for (let i = 0; i < points * 2; i++) {
                const r = i % 2 === 0 ? outerR : innerR;
                const angle = (i * Math.PI / points) - Math.PI / 2;
                const x = Math.cos(angle) * r;
                const y = Math.sin(angle) * r;
                if (i === 0) shape.moveTo(x, y);
                else shape.lineTo(x, y);
            }
            shape.closePath();
            return new THREE.ShapeGeometry(shape);
        };

        // 大星（左上）
        const bigStar = new THREE.Mesh(createStar(0.055, 0.022), starMat);
        bigStar.position.set(-0.2, 0.1, 0.01);
        flagGroup.add(bigStar);

        // 四颗小星（围绕大星右侧，呈弧形）
        const smallStarPositions = [
            { x: -0.1, y: 0.16, rot: 0.5 },    // 右上
            { x: -0.06, y: 0.1, rot: -0.3 },   // 右中上
            { x: -0.06, y: 0.04, rot: 0.2 },   // 右中下
            { x: -0.1, y: -0.02, rot: -0.4 },  // 右下
        ];
        
        smallStarPositions.forEach(pos => {
            const smallStar = new THREE.Mesh(createStar(0.02, 0.008), starMat);
            smallStar.position.set(pos.x, pos.y, 0.01);
            smallStar.rotation.z = pos.rot;  // 小星指向大星
            flagGroup.add(smallStar);
        });

        flagGroup.position.set(0.38, 2.35, 0);
        g.add(flagGroup);

        g.position.set(0, 0, -0.3);
        this.scene.add(g);
    }

    _generateTrees() {
        this.trees.forEach(t => this.scene.remove(t));
        this.trees = [];
        const palette = PALETTES[this.state.season] || PALETTES.spring;
        const isWinter = this.state.season === 'winter';

        for (let i = 0; i < 28; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 7 + Math.random() * 5;
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;

            // 跳过建筑区域
            let skip = false;
            for (const slots of Object.values(SLOTS)) {
                for (const [bx, bz] of slots) {
                    if (Math.hypot(x - bx, z - bz) < 2) { skip = true; break; }
                }
                if (skip) break;
            }
            if (skip) continue;

            const tree = this._mkTree(palette, isWinter);
            tree.position.set(x, 0, z);
            tree.scale.setScalar(0.55 + Math.random() * 0.5);
            tree.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(tree);
            this.trees.push(tree);
        }
    }

    _mkTree(palette, bare) {
        const g = new THREE.Group();
        // 树干
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.11, 0.9, 5),
            new THREE.MeshLambertMaterial({ color: 0x6d4c2e })
        );
        trunk.position.y = 0.45;
        trunk.castShadow = true;
        g.add(trunk);

        if (!bare) {
            // 树冠
            const foliage = new THREE.Mesh(
                new THREE.ConeGeometry(0.55, 1.3, 6),
                new THREE.MeshLambertMaterial({ color: palette.tree })
            );
            foliage.position.y = 1.3;
            foliage.castShadow = true;
            g.add(foliage);

            // 春天点缀花朵
            if (palette === PALETTES.spring && Math.random() > 0.5) {
                const bMat = new THREE.MeshLambertMaterial({ color: palette.accent });
                for (let j = 0; j < 3; j++) {
                    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), bMat);
                    b.position.set(
                        (Math.random() - 0.5) * 0.6,
                        1.0 + Math.random() * 0.7,
                        (Math.random() - 0.5) * 0.6
                    );
                    g.add(b);
                }
            }
        } else {
            // 冬天：枯枝
            const brMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
            for (let j = 0; j < 3; j++) {
                const br = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.015, 0.02, 0.35, 3),
                    brMat
                );
                const angle = (j / 3) * Math.PI * 2 + Math.random() * 0.5;
                br.position.set(Math.cos(angle) * 0.15, 0.8 + j * 0.15, Math.sin(angle) * 0.15);
                br.rotation.z = (Math.random() - 0.5) * 0.8;
                g.add(br);
            }
        }
        return g;
    }

    // ===== 建筑工厂 =====

    _mkHouse(level = 0) {
        const g = new THREE.Group();
        const colors = [
            { wall: 0xd7ccc8, roof: 0x8d6e63 },
            { wall: 0xbcaaa4, roof: 0x6d4c41 },
            { wall: 0x9e9e9e, roof: 0x546e7a },
        ];
        const c = colors[Math.min(level, 2)];
        const s = 1 + level * 0.15;

        // 墙体
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(1.2 * s, 0.9 * s, 1.0 * s),
            new THREE.MeshLambertMaterial({ color: c.wall })
        );
        wall.position.y = 0.45 * s;
        wall.castShadow = true;
        wall.receiveShadow = true;
        g.add(wall);

        // 屋顶
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(0.9 * s, 0.55 * s, 4),
            new THREE.MeshLambertMaterial({ color: c.roof })
        );
        roof.position.y = (0.9 + 0.27) * s;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        g.add(roof);

        // 门
        const door = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.35, 0.04),
            new THREE.MeshLambertMaterial({ color: 0x4e342e })
        );
        door.position.set(0, 0.2, 0.51 * s);
        g.add(door);

        // 窗户（夜间发光）
        const winMat = () => new THREE.MeshBasicMaterial({ color: 0xfff8e1, transparent: true, opacity: 0 });
        const wGeo = new THREE.BoxGeometry(0.18, 0.14, 0.04);
        const w1 = new THREE.Mesh(wGeo, winMat());
        w1.position.set(-0.3 * s, 0.52 * s, 0.51 * s);
        g.add(w1);
        const w2 = new THREE.Mesh(wGeo, winMat());
        w2.position.set(0.3 * s, 0.52 * s, 0.51 * s);
        g.add(w2);

        g.userData.windows = [w1, w2];
        return g;
    }

    _mkFarm(plotData) {
        const g = new THREE.Group();
        // 土壤
        const soilColor = plotData?.watered ? 0x4e342e : 0x6d4c41;
        const soil = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.06, 1.6),
            new THREE.MeshLambertMaterial({ color: soilColor })
        );
        soil.position.y = 0.03;
        soil.receiveShadow = true;
        g.add(soil);

        // 围栏
        const fenceMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
        const fenceGeo = new THREE.BoxGeometry(0.04, 0.18, 1.7);
        const f1 = new THREE.Mesh(fenceGeo, fenceMat);
        f1.position.set(-0.82, 0.09, 0);
        g.add(f1);
        const f2 = new THREE.Mesh(fenceGeo, fenceMat);
        f2.position.set(0.82, 0.09, 0);
        g.add(f2);

        // 根据农田状态显示作物
        const stage = plotData?.stage || 'empty';
        const crop = plotData?.crop;

        if (stage === 'empty') {
            // 空地 - 显示土垄
            const ridgeMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
            for (let i = -2; i <= 2; i++) {
                const ridge = new THREE.Mesh(
                    new THREE.BoxGeometry(0.15, 0.04, 1.3),
                    ridgeMat
                );
                ridge.position.set(i * 0.28, 0.08, 0);
                g.add(ridge);
            }
        } else {
            // 有作物 - 根据阶段调整高度和颜色
            let cropColor = 0x66bb6a; // 默认绿色
            let cropHeight = 0.15;

            if (stage === 'seedling') {
                cropHeight = 0.08;
                cropColor = 0x81c784;
            } else if (stage === 'growing') {
                cropHeight = 0.18;
                cropColor = 0x4caf50;
            } else if (stage === 'mature') {
                cropHeight = 0.28;
                // 成熟时根据作物类型变色
                if (crop === 'wheat') cropColor = 0xfdd835;
                else if (crop === 'radish') cropColor = 0xff7043;
                else if (crop === 'potato') cropColor = 0x8d6e63;
                else if (crop === 'pumpkin') cropColor = 0xff9800;
                else if (crop === 'cotton') cropColor = 0xeeeeee;
                else if (crop === 'grape') cropColor = 0x7b1fa2;
                else cropColor = 0xaed581;
            }

            const rowMat = new THREE.MeshLambertMaterial({ color: cropColor });
            for (let i = -2; i <= 2; i++) {
                const row = new THREE.Mesh(
                    new THREE.BoxGeometry(0.1, cropHeight + Math.random() * 0.05, 1.3),
                    rowMat
                );
                row.position.set(i * 0.28, 0.06 + cropHeight / 2, 0);
                row.castShadow = true;
                g.add(row);
            }

            // 施肥标记
            if (plotData?.fertilized) {
                const fertMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
                for (let i = 0; i < 3; i++) {
                    const pellet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), fertMat);
                    pellet.position.set((Math.random() - 0.5) * 1.2, 0.08, (Math.random() - 0.5) * 1.2);
                    g.add(pellet);
                }
            }
        }
        return g;
    }

    _mkLumber() {
        const g = new THREE.Group();
        // 棚子
        const shed = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.7, 0.8),
            new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
        );
        shed.position.y = 0.35;
        shed.castShadow = true;
        g.add(shed);

        // 棚顶
        const sRoof = new THREE.Mesh(
            new THREE.BoxGeometry(1.25, 0.08, 0.95),
            new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
        );
        sRoof.position.y = 0.74;
        g.add(sRoof);

        // 原木堆
        const logMat = new THREE.MeshLambertMaterial({ color: 0xa1887f });
        for (let i = 0; i < 4; i++) {
            const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.65, 6), logMat);
            log.rotation.z = Math.PI / 2;
            log.position.set(-0.85, 0.07 + i * 0.14, (Math.random() - 0.5) * 0.25);
            log.castShadow = true;
            g.add(log);
        }
        return g;
    }

    _mkQuarry() {
        const g = new THREE.Group();
        const rMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
        for (let i = 0; i < 6; i++) {
            const sz = 0.18 + Math.random() * 0.32;
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), rMat);
            rock.position.set(
                (Math.random() - 0.5) * 1.3,
                sz * 0.45,
                (Math.random() - 0.5) * 1.3
            );
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            rock.castShadow = true;
            g.add(rock);
        }
        return g;
    }

    _mkPond() {
        const g = new THREE.Group();

        // 池塘底部（凹陷效果）
        const pitMat = new THREE.MeshLambertMaterial({ color: 0x3d5a5a });
        const pit = new THREE.Mesh(
            new THREE.CylinderGeometry(1.3, 1.1, 0.25, 16),
            pitMat
        );
        pit.position.y = -0.12;
        pit.receiveShadow = true;
        g.add(pit);

        // 深水区（中心更深色）
        const deepWater = new THREE.Mesh(
            new THREE.CircleGeometry(0.8, 12),
            new THREE.MeshLambertMaterial({ color: 0x0288d1, transparent: true, opacity: 0.6 })
        );
        deepWater.rotation.x = -Math.PI / 2;
        deepWater.position.y = 0.01;
        g.add(deepWater);

        // 浅水区/水面
        const water = new THREE.Mesh(
            new THREE.CircleGeometry(1.25, 20),
            new THREE.MeshLambertMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.75 })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.02;
        g.add(water);

        // 水面高光
        const highlight = new THREE.Mesh(
            new THREE.CircleGeometry(0.3, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
        );
        highlight.rotation.x = -Math.PI / 2;
        highlight.position.set(0.4, 0.03, -0.3);
        g.add(highlight);

        // 石头边缘（多层次）
        const stoneMat1 = new THREE.MeshLambertMaterial({ color: 0x78909c });
        const stoneMat2 = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
        const stoneMat3 = new THREE.MeshLambertMaterial({ color: 0xa5b5bd });
        const mats = [stoneMat1, stoneMat2, stoneMat3];
        
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + Math.random() * 0.2;
            const r = 1.3 + Math.random() * 0.15;
            const size = 0.1 + Math.random() * 0.12;
            const s = new THREE.Mesh(
                new THREE.DodecahedronGeometry(size, 0),
                mats[Math.floor(Math.random() * 3)]
            );
            s.position.set(Math.cos(a) * r, size * 0.4, Math.sin(a) * r);
            s.rotation.set(Math.random(), Math.random(), Math.random());
            s.castShadow = true;
            g.add(s);
        }

        // 内层小石头
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const size = 0.05 + Math.random() * 0.05;
            const s = new THREE.Mesh(
                new THREE.SphereGeometry(size, 4, 4),
                stoneMat2
            );
            s.position.set(Math.cos(a) * 1.15, 0.03, Math.sin(a) * 1.15);
            g.add(s);
        }

        // 芦苇/水草（3簇）
        const reedMat = new THREE.MeshLambertMaterial({ color: 0x558b2f });
        const reedPositions = [[1.1, 0.6], [-0.9, 0.8], [0.2, -1.1]];
        reedPositions.forEach(([rx, rz]) => {
            for (let j = 0; j < 4; j++) {
                const reed = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.015, 0.02, 0.35 + Math.random() * 0.2, 4),
                    reedMat
                );
                reed.position.set(rx + (Math.random() - 0.5) * 0.15, 0.2, rz + (Math.random() - 0.5) * 0.15);
                reed.rotation.x = (Math.random() - 0.5) * 0.15;
                reed.rotation.z = (Math.random() - 0.5) * 0.15;
                g.add(reed);
            }
        });

        // 荷叶（2-3片）
        const lilyMat = new THREE.MeshLambertMaterial({ color: 0x4caf50, side: THREE.DoubleSide });
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + 0.5;
            const dist = 0.5 + Math.random() * 0.4;
            const lily = new THREE.Mesh(
                new THREE.CircleGeometry(0.12 + Math.random() * 0.06, 8),
                lilyMat
            );
            lily.rotation.x = -Math.PI / 2;
            lily.position.set(Math.cos(angle) * dist, 0.025, Math.sin(angle) * dist);
            g.add(lily);
        }

        // 小鱼（简化表示）
        const fishMat = new THREE.MeshLambertMaterial({ color: 0xff7043 });
        for (let i = 0; i < 2; i++) {
            const fish = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), fishMat);
            body.scale.set(1.5, 0.8, 1);
            fish.add(body);
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 3), fishMat);
            tail.rotation.z = Math.PI / 2;
            tail.position.x = -0.06;
            fish.add(tail);
            fish.position.set((Math.random() - 0.5) * 0.6, 0.015, (Math.random() - 0.5) * 0.6);
            fish.rotation.y = Math.random() * Math.PI * 2;
            fish.userData.swimPhase = Math.random() * Math.PI * 2;
            g.add(fish);
        }

        // 钓鱼台/木板（可选装饰）
        const plankMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.35), plankMat);
        plank.position.set(1.35, 0.02, 0);
        plank.rotation.y = -0.2;
        g.add(plank);
        // 木桩支撑
        const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 4), plankMat);
        post1.position.set(1.2, -0.05, 0.1);
        g.add(post1);
        const post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 4), plankMat);
        post2.position.set(1.2, -0.05, -0.1);
        g.add(post2);

        g.userData.water = water;
        g.userData.highlight = highlight;
        return g;
    }

    _mkMill() {
        const g = new THREE.Group();
        // 主体
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.48, 0.58, 1.3, 8),
            new THREE.MeshLambertMaterial({ color: 0xbcaaa4 })
        );
        body.position.y = 0.65;
        body.castShadow = true;
        g.add(body);

        // 屋顶
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(0.52, 0.45, 8),
            new THREE.MeshLambertMaterial({ color: 0x795548 })
        );
        roof.position.y = 1.52;
        roof.castShadow = true;
        g.add(roof);

        // 风车叶片组
        const blades = new THREE.Group();
        const bMat = new THREE.MeshLambertMaterial({ color: 0xefebe9 });
        for (let i = 0; i < 4; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.02), bMat);
            blade.position.y = 0.42;
            const arm = new THREE.Group();
            arm.add(blade);
            arm.rotation.z = (i / 4) * Math.PI * 2;
            blades.add(arm);
        }
        blades.position.set(0, 0.95, 0.55);
        blades.rotation.x = 0.15;
        g.add(blades);

        g.userData.blades = blades;
        return g;
    }

    _mkBakery() {
        const g = new THREE.Group();
        // 主体
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 0.85, 0.95),
            new THREE.MeshLambertMaterial({ color: 0xffccbc })
        );
        body.position.y = 0.42;
        body.castShadow = true;
        g.add(body);

        // 屋顶
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(0.88, 0.45, 4),
            new THREE.MeshLambertMaterial({ color: 0xd7ccc8 })
        );
        roof.position.y = 1.07;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        g.add(roof);

        // 烟囱
        const chimney = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.45, 0.14),
            new THREE.MeshLambertMaterial({ color: 0x795548 })
        );
        chimney.position.set(0.3, 1.25, -0.2);
        g.add(chimney);

        // 烟雾粒子组
        const smokeGroup = new THREE.Group();
        smokeGroup.position.set(0.3, 1.5, -0.2);
        const smokeMat = new THREE.MeshBasicMaterial({ 
            color: 0xaaaaaa, 
            transparent: true, 
            opacity: 0.5 
        });
        for (let i = 0; i < 5; i++) {
            const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), smokeMat.clone());
            smoke.position.y = i * 0.15;
            smoke.userData.baseY = smoke.position.y;
            smoke.userData.phase = i * 0.5;
            smokeGroup.add(smoke);
        }
        g.add(smokeGroup);
        g.userData.smoke = smokeGroup;

        return g;
    }

    _mkWell() {
        const g = new THREE.Group();
        // 井壁
        const wall = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.28, 0.35, 8, 1, true),
            new THREE.MeshLambertMaterial({ color: 0x90a4ae, side: THREE.DoubleSide })
        );
        wall.position.y = 0.175;
        g.add(wall);

        // 井圈
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.3, 0.06, 6, 8),
            new THREE.MeshLambertMaterial({ color: 0x78909c })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.36;
        g.add(ring);

        // 小屋顶
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(0.32, 0.28, 4),
            new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
        );
        roof.position.y = 0.68;
        roof.rotation.y = Math.PI / 4;
        g.add(roof);

        // 柱子
        const pMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
        for (let i = 0; i < 2; i++) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 4), pMat);
            p.position.set(i === 0 ? -0.22 : 0.22, 0.47, 0);
            g.add(p);
        }
        return g;
    }

    _mkWarehouse() {
        const g = new THREE.Group();
        // 主体
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 1.05, 1.0),
            new THREE.MeshLambertMaterial({ color: 0xa1887f })
        );
        body.position.y = 0.52;
        body.castShadow = true;
        g.add(body);

        // 屋顶
        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.1, 1.15),
            new THREE.MeshLambertMaterial({ color: 0x6d4c41 })
        );
        roof.position.y = 1.1;
        g.add(roof);

        // 箱子
        const bMat = new THREE.MeshLambertMaterial({ color: 0xffe082 });
        const bGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
        for (let i = 0; i < 3; i++) {
            const box = new THREE.Mesh(bGeo, bMat);
            box.position.set(-0.85, 0.11 + i * 0.22, (i - 1) * 0.12);
            box.castShadow = true;
            g.add(box);
        }
        return g;
    }

    _mkMarket() {
        const g = new THREE.Group();

        // 主摊位棚子
        const tentMat = new THREE.MeshLambertMaterial({ color: 0xe57373 });
        const tentMat2 = new THREE.MeshLambertMaterial({ color: 0xffecb3 });

        // 主棚顶（条纹效果用两个斜面）
        const canopy1 = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.05, 0.9),
            tentMat
        );
        canopy1.position.set(0, 1.1, -0.2);
        canopy1.rotation.x = -0.15;
        g.add(canopy1);

        const canopy2 = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.05, 0.9),
            tentMat2
        );
        canopy2.position.set(0, 1.05, 0.5);
        canopy2.rotation.x = 0.15;
        g.add(canopy2);

        // 支撑柱（4根）
        const poleMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
        const polePositions = [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.7], [0.7, 0.7]];
        polePositions.forEach(([x, z]) => {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 1.15, 6),
                poleMat
            );
            pole.position.set(x, 0.575, z);
            pole.castShadow = true;
            g.add(pole);
        });

        // 柜台
        const counter = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.12, 0.5),
            new THREE.MeshLambertMaterial({ color: 0xa1887f })
        );
        counter.position.set(0, 0.56, 0);
        counter.castShadow = true;
        g.add(counter);

        // 柜台支撑
        const counterLeg = new THREE.Mesh(
            new THREE.BoxGeometry(1.3, 0.5, 0.08),
            new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
        );
        counterLeg.position.set(0, 0.25, 0.2);
        g.add(counterLeg);

        // 商品展示 - 水果篮
        const basketMat = new THREE.MeshLambertMaterial({ color: 0xd7ccc8 });
        const fruitColors = [0xff7043, 0xffd54f, 0x81c784, 0xef5350];
        for (let i = 0; i < 3; i++) {
            const basket = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.1, 0.1, 8),
                basketMat
            );
            basket.position.set(-0.4 + i * 0.4, 0.67, -0.05);
            g.add(basket);

            // 水果
            for (let j = 0; j < 4; j++) {
                const fruit = new THREE.Mesh(
                    new THREE.SphereGeometry(0.04, 6, 6),
                    new THREE.MeshLambertMaterial({ color: fruitColors[(i + j) % 4] })
                );
                fruit.position.set(
                    -0.4 + i * 0.4 + (Math.random() - 0.5) * 0.1,
                    0.74 + j * 0.02,
                    -0.05 + (Math.random() - 0.5) * 0.08
                );
                g.add(fruit);
            }
        }

        // 布袋（谷物）
        const bagMat = new THREE.MeshLambertMaterial({ color: 0xbcaaa4 });
        for (let i = 0; i < 2; i++) {
            const bag = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.12, 0.18, 6),
                bagMat
            );
            bag.position.set(-0.5 + i * 1, 0.09, 0.5);
            bag.castShadow = true;
            g.add(bag);
        }

        // 木箱
        const crate = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.2, 0.25),
            new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
        );
        crate.position.set(0.55, 0.1, -0.4);
        crate.castShadow = true;
        g.add(crate);

        // 称/秤
        const scalePole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.25, 4),
            new THREE.MeshLambertMaterial({ color: 0x5d4037 })
        );
        scalePole.position.set(-0.55, 0.75, 0);
        g.add(scalePole);

        const scaleArm = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.015, 0.015),
            new THREE.MeshLambertMaterial({ color: 0x5d4037 })
        );
        scaleArm.position.set(-0.55, 0.88, 0);
        g.add(scaleArm);

        // 招牌
        const signBoard = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.25, 0.03),
            new THREE.MeshLambertMaterial({ color: 0xfff8e1 })
        );
        signBoard.position.set(0, 1.35, 0.1);
        g.add(signBoard);

        return g;
    }

    // ===== 村民模型 =====

    _mkVillager(color) {
        const g = new THREE.Group();
        // 身体
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.3, 6),
            new THREE.MeshLambertMaterial({ color })
        );
        body.position.y = 0.25;
        g.add(body);

        // 头
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 6, 6),
            new THREE.MeshLambertMaterial({ color: 0xffccbc })
        );
        head.position.y = 0.48;
        g.add(head);

        g.castShadow = true;
        return g;
    }

    // ===== 天气粒子 =====

    _setWeatherParticles(type) {
        this._clearWeather();
        if (!type) return;

        const count = type === 'rain' ? 600 : 350;
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 28;
            positions[i * 3 + 1] = Math.random() * 14;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 28;
            speeds[i] = 0.5 + Math.random() * 0.5;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: type === 'rain' ? 0x64b5f6 : 0xffffff,
            size: type === 'rain' ? 0.06 : 0.12,
            transparent: true,
            opacity: type === 'rain' ? 0.5 : 0.75,
        });

        this.weatherParticles = new THREE.Points(geo, mat);
        this.weatherParticles.userData = { speeds, type };
        this.scene.add(this.weatherParticles);
    }

    _clearWeather() {
        if (this.weatherParticles) {
            this.scene.remove(this.weatherParticles);
            this.weatherParticles.geometry.dispose();
            this.weatherParticles.material.dispose();
            this.weatherParticles = null;
        }
    }

    _animWeather(dt) {
        if (!this.weatherParticles) return;
        const pos = this.weatherParticles.geometry.attributes.position.array;
        const { speeds, type } = this.weatherParticles.userData;
        const spd = type === 'rain' ? 14 : 2.5;

        for (let i = 0; i < speeds.length; i++) {
            pos[i * 3 + 1] -= speeds[i] * spd * dt;
            if (type !== 'rain') {
                pos[i * 3] += Math.sin(this.elapsed * 2 + i) * 0.008;
                pos[i * 3 + 2] += Math.cos(this.elapsed * 2.5 + i) * 0.008;
            }
            if (pos[i * 3 + 1] < 0) {
                pos[i * 3 + 1] = 12 + Math.random() * 2;
                pos[i * 3] = (Math.random() - 0.5) * 28;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 28;
            }
        }
        this.weatherParticles.geometry.attributes.position.needsUpdate = true;
    }

    // ===== 相机控制 =====

    _initControls() {
        const el = this.renderer.domElement;

        // 鼠标
        el.addEventListener('mousedown', e => {
            this.dragging = true;
            this.lastMouse.x = e.clientX;
            this.lastMouse.y = e.clientY;
            this.autoRotate = false;
        });
        el.addEventListener('mousemove', e => {
            if (!this.dragging) return;
            this.camAngle += (e.clientX - this.lastMouse.x) * 0.006;
            this.camElev = Math.max(0.12, Math.min(0.85, this.camElev + (e.clientY - this.lastMouse.y) * 0.004));
            this.lastMouse.x = e.clientX;
            this.lastMouse.y = e.clientY;
            this._updateCamPos();
        });
        el.addEventListener('mouseup', () => { this.dragging = false; });
        el.addEventListener('mouseleave', () => { this.dragging = false; });
        el.addEventListener('wheel', e => {
            e.preventDefault();
            this.camDist = Math.max(8, Math.min(35, this.camDist + e.deltaY * 0.025));
            this._updateCamPos();
        }, { passive: false });

        // 触摸
        let lastTD = 0;
        el.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                this.dragging = true;
                this.lastMouse.x = e.touches[0].clientX;
                this.lastMouse.y = e.touches[0].clientY;
                this.autoRotate = false;
            } else if (e.touches.length === 2) {
                lastTD = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        });
        el.addEventListener('touchmove', e => {
            e.preventDefault();
            if (e.touches.length === 1 && this.dragging) {
                this.camAngle += (e.touches[0].clientX - this.lastMouse.x) * 0.006;
                this.camElev = Math.max(0.12, Math.min(0.85, this.camElev + (e.touches[0].clientY - this.lastMouse.y) * 0.004));
                this.lastMouse.x = e.touches[0].clientX;
                this.lastMouse.y = e.touches[0].clientY;
                this._updateCamPos();
            } else if (e.touches.length === 2) {
                const d = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                this.camDist = Math.max(8, Math.min(35, this.camDist - (d - lastTD) * 0.06));
                lastTD = d;
                this._updateCamPos();
            }
        }, { passive: false });
        el.addEventListener('touchend', () => { this.dragging = false; });

        // 双击重置视角
        el.addEventListener('dblclick', () => {
            this.camAngle = 0.6;
            this.camElev = 0.45;
            this.camDist = 20;
            this.autoRotate = true;
            this._updateCamPos();
        });

        window.addEventListener('resize', () => { if (this.isActive) this._resize(); });
    }

    _updateCamPos() {
        if (!this.camera) return;
        const elev = this.camElev * Math.PI * 0.48;
        const x = Math.sin(this.camAngle) * Math.cos(elev) * this.camDist;
        const y = Math.sin(elev) * this.camDist;
        const z = Math.cos(this.camAngle) * Math.cos(elev) * this.camDist;
        this.camera.position.set(x + this.camTarget.x, y, z + this.camTarget.z);
        this.camera.lookAt(this.camTarget);
    }

    // ===== 游戏状态同步 =====

    _syncAll() {
        this._syncSeason();
        this._syncDayNight();
        this._syncBuildings();
        this._syncVillagers();
        this._syncWeather();
    }

    _syncSeason() {
        const season = this.state.season;
        if (season === this._cSeason) return;
        this._cSeason = season;
        const p = PALETTES[season] || PALETTES.spring;

        this.groundMesh.material.color.setHex(p.ground);
        this.groundEdgeMesh.material.color.setHex(p.groundEdge);
        this.scene.background.setHex(p.sky);
        this.scene.fog.color.setHex(p.sky);
        this.hemiLight.color.setHex(p.sky);
        this.pathMeshes.forEach(m => m.material.color.setHex(p.path));

        this._generateTrees();
        this._createFlowersAndRocks();
        this._createNeighborVillages();  // 更新邻村季节颜色
    }

    _syncDayNight() {
        const h = this.state.time.hour;
        if (h === this._cHour) return;
        this._cHour = h;

        const L = this._lighting;
        const p = PALETTES[this.state.season] || PALETTES.spring;

        // 根据时间计算目标光照值（渐变过渡到这些值）
        if (h >= 5 && h < 7) {
            // 黎明（5-7点）：从夜晚过渡到早晨
            const t = (h - 5) / 2;
            L.targetSunIntensity = 0.08 + t * 0.4;
            L.targetAmbIntensity = 0.15 + t * 0.15;
            L.targetSunColor.lerpColors(new THREE.Color(0x5c6bc0), new THREE.Color(0xffb74d), t);
            L.targetSkyColor.lerpColors(new THREE.Color(0x1a237e), new THREE.Color(0xffccbc), t);
            L.targetFogColor.copy(L.targetSkyColor);
            L.targetExposure = 0.6 + t * 0.3;
        } else if (h >= 7 && h < 9) {
            // 早晨（7-9点）：日出后
            const t = (h - 7) / 2;
            L.targetSunIntensity = 0.48 + t * 0.72;
            L.targetAmbIntensity = 0.3 + t * 0.25;
            L.targetSunColor.lerpColors(new THREE.Color(0xffb74d), new THREE.Color(0xffeedd), t);
            L.targetSkyColor.lerpColors(new THREE.Color(0xffccbc), new THREE.Color(p.sky), t);
            L.targetFogColor.copy(L.targetSkyColor);
            L.targetExposure = 0.9 + t * 0.1;
        } else if (h >= 9 && h < 16) {
            // 白天（9-16点）
            L.targetSunIntensity = 1.2;
            L.targetAmbIntensity = 0.55;
            L.targetSunColor.setHex(0xffeedd);
            L.targetSkyColor.setHex(p.sky);
            L.targetFogColor.setHex(p.sky);
            L.targetExposure = 1.0;
        } else if (h >= 16 && h < 18) {
            // 傍晚前（16-18点）
            const t = (h - 16) / 2;
            L.targetSunIntensity = 1.2 - t * 0.3;
            L.targetAmbIntensity = 0.55 - t * 0.1;
            L.targetSunColor.lerpColors(new THREE.Color(0xffeedd), new THREE.Color(0xffa726), t);
            L.targetSkyColor.lerpColors(new THREE.Color(p.sky), new THREE.Color(0xffab91), t);
            L.targetFogColor.copy(L.targetSkyColor);
            L.targetExposure = 1.0;
        } else if (h >= 18 && h < 20) {
            // 黄昏（18-20点）
            const t = (h - 18) / 2;
            L.targetSunIntensity = 0.9 - t * 0.7;
            L.targetAmbIntensity = 0.45 - t * 0.25;
            L.targetSunColor.lerpColors(new THREE.Color(0xffa726), new THREE.Color(0xff5722), t);
            L.targetSkyColor.lerpColors(new THREE.Color(0xffab91), new THREE.Color(0x3949ab), t);
            L.targetFogColor.copy(L.targetSkyColor);
            L.targetExposure = 1.0 - t * 0.3;
        } else if (h >= 20 && h < 22) {
            // 入夜（20-22点）
            const t = (h - 20) / 2;
            L.targetSunIntensity = 0.2 - t * 0.12;
            L.targetAmbIntensity = 0.2 - t * 0.05;
            L.targetSunColor.lerpColors(new THREE.Color(0xff5722), new THREE.Color(0x5c6bc0), t);
            L.targetSkyColor.lerpColors(new THREE.Color(0x3949ab), new THREE.Color(0x1a237e), t);
            L.targetFogColor.copy(L.targetSkyColor);
            L.targetExposure = 0.7 - t * 0.1;
        } else {
            // 深夜（22-5点）
            L.targetSunIntensity = 0.08;
            L.targetAmbIntensity = 0.15;
            L.targetSunColor.setHex(0x5c6bc0);
            L.targetSkyColor.setHex(0x1a237e);
            L.targetFogColor.setHex(0x1a237e);
            L.targetExposure = 0.6;
        }

        // 太阳和月亮位置
        this._updateCelestialBodies(h);

        // 更新天空元素（云朵、星星）- 考虑天气
        const isNight = h >= 20 || h < 6;
        this._updateSkyElements(isNight);

        // 窗户灯光（渐变）
        const wOn = h >= 19 || h < 6;
        this.buildingMap.forEach(grp => {
            (grp.userData.windows || []).forEach(w => {
                const targetOpacity = wOn ? 0.9 : 0;
                w.material.opacity += (targetOpacity - w.material.opacity) * 0.1;
            });
        });
    }

    /**
     * 更新太阳和月亮位置
     */
    _updateCelestialBodies(h) {
        if (!this.sunMesh || !this.moonMesh) return;

        // 太阳：5:00 升起，19:00 落下
        const sunAngle = ((h - 5) / 14) * Math.PI;
        if (h >= 5 && h <= 19) {
            this.sunMesh.visible = true;
            const sunHeight = Math.sin(sunAngle) * 18 + 2;
            const sunX = Math.cos(sunAngle) * 22;
            this.sunMesh.position.set(sunX, Math.max(2, sunHeight), -12);
            
            // 日出日落时太阳变红
            if (h < 7 || h > 17) {
                this.sunMesh.material.color.setHex(0xff8c42);
                this.sunMesh.children[0].material.color.setHex(0xffaa66);
            } else {
                this.sunMesh.material.color.setHex(0xffdd00);
                this.sunMesh.children[0].material.color.setHex(0xffee88);
            }
        } else {
            this.sunMesh.visible = false;
        }

        // 月亮：18:00 升起，6:00 落下
        const moonHour = h >= 18 ? h - 18 : h + 6;
        const moonAngle = (moonHour / 12) * Math.PI;
        if (h >= 18 || h <= 6) {
            this.moonMesh.visible = true;
            const moonHeight = Math.sin(moonAngle) * 16 + 2;
            const moonX = -Math.cos(moonAngle) * 20;
            this.moonMesh.position.set(moonX, Math.max(2, moonHeight), 10);
        } else {
            this.moonMesh.visible = false;
        }
    }

    /**
     * 平滑插值光照过渡（在动画循环中调用）
     */
    _animateLightingTransition(dt) {
        const L = this._lighting;
        const speed = this._transitionSpeed * dt;

        // 数值插值
        L.sunIntensity += (L.targetSunIntensity - L.sunIntensity) * speed;
        L.ambIntensity += (L.targetAmbIntensity - L.ambIntensity) * speed;
        L.exposure += (L.targetExposure - L.exposure) * speed;

        // 颜色插值
        L.sunColor.lerp(L.targetSunColor, speed);
        L.skyColor.lerp(L.targetSkyColor, speed);
        L.fogColor.lerp(L.targetFogColor, speed);

        // 应用到场景
        this.sunLight.intensity = L.sunIntensity;
        this.sunLight.color.copy(L.sunColor);
        this.ambientLight.intensity = L.ambIntensity;
        this.scene.background.copy(L.skyColor);
        this.scene.fog.color.copy(L.fogColor);
        this.renderer.toneMappingExposure = L.exposure;
    }

    _syncBuildings() {
        const buildings = this.state.buildings || [];
        const plots = this.state.plots || [];

        // 生成变化检测 key（用 type 而不是 id）
        // 包含农田的状态以便状态变化时刷新
        const plotsKey = plots.map(p => `${p.stage}:${p.crop || ''}:${p.watered ? 'w' : ''}:${p.fertilized ? 'f' : ''}`).join('|');
        const key = buildings.map(b => `${b.type}:${b.level || 0}`).join(',')
            + `,plots:${plotsKey}`
            + (this.state.fishing?.pondBuilt ? ',pond' : '');
        if (key === this._cBldKey) return;
        this._cBldKey = key;

        // 清除旧建筑
        this.buildingMap.forEach(g => this.scene.remove(g));
        this.buildingMap.clear();

        // 统计各类建筑（用 type 字段）
        const counts = {};
        buildings.forEach(b => {
            const t = b.type;
            if (!counts[t]) counts[t] = [];
            counts[t].push(b);
        });

        // 放置函数
        const place = (type, list, factory) => {
            const slots = SLOTS[type];
            if (!slots) return;
            list.forEach((bData, i) => {
                if (i >= slots.length) return;
                const mesh = factory(bData);
                mesh.position.set(slots[i][0], 0, slots[i][1]);
                this.scene.add(mesh);
                this.buildingMap.set(`${type}_${i}`, mesh);
            });
        };

        // 住宅
        if (counts.house) place('house', counts.house, b => this._mkHouse(b.level || 0));

        // 农田（从 plots 数组获取，不是 buildings）
        if (plots.length > 0) {
            place('farmPlot', plots, p => this._mkFarm(p));
        }

        // 其他生产建筑
        if (counts.lumberYard) place('lumberYard', counts.lumberYard, () => this._mkLumber());
        if (counts.quarry) place('quarry', counts.quarry, () => this._mkQuarry());
        if (counts.mill) place('mill', counts.mill, () => this._mkMill());
        if (counts.bakery) place('bakery', counts.bakery, () => this._mkBakery());
        if (counts.well) place('well', counts.well, () => this._mkWell());
        if (counts.warehouse) place('warehouse', counts.warehouse, () => this._mkWarehouse());

        // 市场（默认显示，因为市场是村庄核心功能）
        const market = this._mkMarket();
        market.position.set(SLOTS.market[0][0], 0, SLOTS.market[0][1]);
        this.scene.add(market);
        this.buildingMap.set('market_0', market);

        // 鱼塘（特殊：通过 fishing.pondBuilt 或 fishPond 类型判断）
        if (this.state.fishing.pondBuilt || counts.fishPond) {
            const pond = this._mkPond();
            pond.position.set(SLOTS.fishPond[0][0], 0, SLOTS.fishPond[0][1]);
            this.scene.add(pond);
            this.buildingMap.set('fishPond_0', pond);
        }
    }

    _syncVillagers() {
        const villagers = this.state.villagers;

        // 数量变化时重建
        if (villagers.length !== this._cVilCnt) {
            this._cVilCnt = villagers.length;
            this.villagerMap.forEach(v => this.scene.remove(v.mesh));
            this.villagerMap.clear();

            villagers.forEach((v, i) => {
                const mesh = this._mkVillager(VILLAGER_COLORS[i % VILLAGER_COLORS.length]);
                const home = SLOTS.house[i] || [0, 0];
                mesh.position.set(home[0], 0, home[1]);
                this.scene.add(mesh);
                this.villagerMap.set(v.id, {
                    mesh,
                    homeSlot: home,           // 记住家的位置
                    tx: home[0],
                    tz: home[1],
                    speed: 1.5 + Math.random() * 0.5,
                    bobOff: Math.random() * Math.PI * 2,
                    idleTimer: 0,
                    lastAction: '',
                    waypoints: [],            // 路径点队列
                    currentWaypoint: 0,
                    state: 'idle',            // idle, walking, working
                    workTimer: 0,
                });
            });
        }

        // 更新村民目标和路径
        villagers.forEach((v, i) => {
            const vd = this.villagerMap.get(v.id);
            if (!vd) return;
            const action = v.currentAction || '';
            const h = this.state.time.hour;

            // 动作变化时重新规划路径
            if (action !== vd.lastAction) {
                vd.lastAction = action;
                vd.state = 'walking';
                vd.workTimer = 0;

                // 确定目标建筑类型
                let targetType = null;
                for (const [kw, bType] of Object.entries(ACTION_TARGET)) {
                    if (action.includes(kw)) { targetType = bType; break; }
                }

                // 生成合理的路径
                const currentPos = [vd.mesh.position.x, vd.mesh.position.z];
                vd.waypoints = this._planVillagerPath(currentPos, targetType, vd.homeSlot, h, i);
                vd.currentWaypoint = 0;

                // 设置第一个路径点为目标
                if (vd.waypoints.length > 0) {
                    const wp = vd.waypoints[0];
                    vd.tx = wp[0];
                    vd.tz = wp[1];
                }
            }
        });
    }

    /**
     * 为村民规划合理的移动路径
     */
    _planVillagerPath(currentPos, targetType, homeSlot, hour, villagerIndex) {
        const waypoints = [];
        const [cx, cz] = currentPos;

        // 确定最终目标位置
        let finalTarget = null;
        if (targetType && SLOTS[targetType]) {
            const slots = SLOTS[targetType];
            // 优先选择距离较近的槽位，但加入一些随机性
            const idx = Math.min(villagerIndex % slots.length, slots.length - 1);
            const slot = slots[idx];
            finalTarget = [slot[0] + (Math.random() - 0.5) * 0.8, slot[1] + (Math.random() - 0.5) * 0.8];
        } else {
            // 无特定任务时，根据时间决定合理的日常行为
            const rand = Math.random();
            
            if (hour >= 22 || hour < 5) {
                // 深夜（22:00-5:00）：在家睡觉
                finalTarget = [homeSlot[0] + (Math.random() - 0.5) * 0.2, homeSlot[1] + (Math.random() - 0.5) * 0.2];
            } else if (hour >= 5 && hour < 7) {
                // 清晨（5:00-7:00）：起床，在家附近活动或去井边打水
                if (rand > 0.6) {
                    const well = SLOTS.well[0];
                    finalTarget = [well[0] + (Math.random() - 0.5) * 0.8, well[1] + (Math.random() - 0.5) * 0.8];
                } else {
                    finalTarget = [homeSlot[0] + (Math.random() - 0.5) * 1.5, homeSlot[1] + (Math.random() - 0.5) * 1.5];
                }
            } else if (hour >= 7 && hour < 12) {
                // 上午（7:00-12:00）：工作时间，可能在农田、伐木场等
                const workPlaces = ['farmPlot', 'lumberYard', 'quarry', 'mill'];
                const place = workPlaces[Math.floor(rand * workPlaces.length)];
                if (SLOTS[place] && SLOTS[place].length > 0) {
                    const slot = SLOTS[place][villagerIndex % SLOTS[place].length];
                    finalTarget = [slot[0] + (Math.random() - 0.5) * 1, slot[1] + (Math.random() - 0.5) * 1];
                } else {
                    finalTarget = [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6];
                }
            } else if (hour >= 12 && hour < 14) {
                // 午休（12:00-14:00）：回家吃饭或在村庄中心休息
                if (rand > 0.4) {
                    finalTarget = [homeSlot[0] + (Math.random() - 0.5) * 0.5, homeSlot[1] + (Math.random() - 0.5) * 0.5];
                } else {
                    // 在村庄中心（旗帜附近）休息聊天
                    finalTarget = [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2];
                }
            } else if (hour >= 14 && hour < 18) {
                // 下午（14:00-18:00）：继续工作或去市场
                if (rand > 0.7) {
                    const warehouse = SLOTS.warehouse[0];
                    finalTarget = [warehouse[0] + (Math.random() - 0.5) * 1, warehouse[1] + (Math.random() - 0.5) * 1];
                } else {
                    const workPlaces = ['farmPlot', 'bakery', 'mill'];
                    const place = workPlaces[Math.floor(rand * workPlaces.length)];
                    if (SLOTS[place] && SLOTS[place].length > 0) {
                        const slot = SLOTS[place][villagerIndex % SLOTS[place].length];
                        finalTarget = [slot[0] + (Math.random() - 0.5) * 1, slot[1] + (Math.random() - 0.5) * 1];
                    }
                }
            } else if (hour >= 18 && hour < 20) {
                // 傍晚（18:00-20:00）：收工回家，或在村庄闲逛
                if (rand > 0.5) {
                    finalTarget = [homeSlot[0] + (Math.random() - 0.5) * 1, homeSlot[1] + (Math.random() - 0.5) * 1];
                } else {
                    // 在村庄散步
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 2 + Math.random() * 3;
                    finalTarget = [Math.cos(angle) * dist, Math.sin(angle) * dist];
                }
            } else {
                // 晚上（20:00-22:00）：准备睡觉，在家附近
                finalTarget = [homeSlot[0] + (Math.random() - 0.5) * 0.8, homeSlot[1] + (Math.random() - 0.5) * 0.8];
            }
            
            // 确保有目标
            if (!finalTarget) {
                finalTarget = [homeSlot[0], homeSlot[1]];
            }
        }

        if (!finalTarget) return waypoints;

        const [tx, tz] = finalTarget;

        // 判断是否需要经过道路（如果起点和终点在不同区域）
        const needRoad = this._shouldUseRoad(cx, cz, tx, tz);

        if (needRoad) {
            // 先走到最近的道路点
            const roadPoint = this._getNearestRoadPoint(cx, cz);
            if (roadPoint) {
                waypoints.push(roadPoint);
            }

            // 如果目标较远，经过村庄中心
            const dist = Math.hypot(tx - cx, tz - cz);
            if (dist > 6) {
                // 添加中心点作为中转
                waypoints.push([0 + (Math.random() - 0.5) * 0.5, 0 + (Math.random() - 0.5) * 0.5]);
            }

            // 走到目标附近的道路点
            const destRoadPoint = this._getNearestRoadPoint(tx, tz);
            if (destRoadPoint && Math.hypot(destRoadPoint[0] - roadPoint?.[0], destRoadPoint[1] - roadPoint?.[1]) > 1) {
                waypoints.push(destRoadPoint);
            }
        }

        // 最终目标
        waypoints.push(finalTarget);

        return waypoints;
    }

    /**
     * 判断是否需要走道路
     */
    _shouldUseRoad(x1, z1, x2, z2) {
        const dist = Math.hypot(x2 - x1, z2 - z1);
        // 短距离直接走
        if (dist < 3) return false;
        // 在同一区域内不需要走道路
        if (Math.sign(x1) === Math.sign(x2) && Math.sign(z1) === Math.sign(z2)) {
            if (dist < 5) return false;
        }
        return true;
    }

    /**
     * 获取最近的道路点
     */
    _getNearestRoadPoint(x, z) {
        // 道路是十字形：x=0 或 z=0
        // 选择最近的道路点
        if (Math.abs(x) < Math.abs(z)) {
            // 靠近南北道路（x=0）
            return [0, z * 0.9]; // 稍微往中心靠
        } else {
            // 靠近东西道路（z=0）
            return [x * 0.9, 0];
        }
    }

    _syncWeather() {
        const w = this.state.weather;
        const id = w.activeEvent || w.current;
        if (id === this._cWeather) return;
        this._cWeather = id;

        const isRain = id && /[Rr]ain|thunderstorm|storm/.test(id);
        const isSnow = id && /[Ss]now|blizzard|[Ff]rost/.test(id);

        if (isRain) this._setWeatherParticles('rain');
        else if (isSnow) this._setWeatherParticles('snow');
        else this._clearWeather();

        // 天气变化时更新天空元素
        const h = this.state.time.hour;
        const isNight = h >= 20 || h < 6;
        this._updateSkyElements(isNight);
    }

    /**
     * 根据时间和天气更新天空元素（云朵、星星、太阳、月亮）
     */
    _updateSkyElements(isNight) {
        const w = this.state.weather;
        const weatherId = w.activeEvent || w.current || '';
        
        // 判断天气类型
        const isRainy = /[Rr]ain|thunderstorm|storm|[Dd]rizzle/.test(weatherId);
        const isSnowy = /[Ss]now|blizzard|[Ff]rost/.test(weatherId);
        const isCloudy = /[Cc]loud|[Oo]vercast|[Ff]og|[Mm]ist/.test(weatherId);
        const isBadWeather = isRainy || isSnowy || isCloudy;
        
        // 云朵显示逻辑：
        // - 白天：正常显示白云（除非是完全晴朗的天气也可以显示）
        // - 阴雨天：云朵变暗变多
        // - 夜间晴朗：云朵减少
        this.clouds.forEach((cloud, i) => {
            if (isNight && !isBadWeather) {
                // 晴朗夜晚：部分云朵隐藏，让星星更清晰
                cloud.visible = i < 2; // 只保留2朵
                cloud.children.forEach(puff => {
                    puff.material.color.setHex(0x3a4a5a);
                    puff.material.opacity = 0.3;
                });
            } else if (isBadWeather) {
                // 阴雨雪天：云朵变暗变厚
                cloud.visible = true;
                cloud.children.forEach(puff => {
                    puff.material.color.setHex(isNight ? 0x2d3748 : 0x78909c);
                    puff.material.opacity = 0.9;
                });
            } else {
                // 晴朗白天：正常白云
                cloud.visible = true;
                cloud.children.forEach(puff => {
                    puff.material.color.setHex(0xffffff);
                    puff.material.opacity = 0.85;
                });
            }
        });

        // 星星显示逻辑：
        // - 夜间晴朗：星星明亮
        // - 夜间阴雨：星星被云遮挡，不可见或很暗
        // - 白天：不可见
        if (this.stars) {
            if (isNight && !isBadWeather) {
                this.stars.visible = true;
                this.stars.material.opacity = 0.9;
            } else if (isNight && isBadWeather) {
                // 阴雨夜晚，星星很暗或不可见
                this.stars.visible = true;
                this.stars.material.opacity = 0.15;
            } else {
                this.stars.visible = false;
            }
        }

        // 太阳显示：阴雨天被云遮挡变暗
        if (this.sunMesh && this.sunMesh.visible) {
            if (isBadWeather) {
                this.sunMesh.children[0].material.opacity = 0.1; // 光晕变弱
            } else {
                this.sunMesh.children[0].material.opacity = 0.3;
            }
        }

        // 月亮显示：阴雨天被云遮挡
        if (this.moonMesh && this.moonMesh.visible) {
            if (isBadWeather) {
                this.moonMesh.children[0].material.opacity = 0.05;
            } else {
                this.moonMesh.children[0].material.opacity = 0.2;
            }
        }
    }

    // ===== 动画循环 =====

    _startLoop() {
        if (this.animFrame) return;
        this.clock.start();
        const loop = () => {
            this.animFrame = requestAnimationFrame(loop);
            const dt = Math.min(this.clock.getDelta(), 0.05);
            this.elapsed += dt;

            // 自动旋转
            if (this.autoRotate && !this.dragging) {
                this.camAngle += 0.06 * dt;
                this._updateCamPos();
            }

            // 光照渐变过渡
            this._animateLightingTransition(dt);

            // 动画
            this._animVillagers(dt);
            this._animWeather(dt);
            this._animBuildings(dt);
            this._animClouds(dt);
            this._animDecorations(dt);

            // 旗帜飘
            if (this.flagMesh) this.flagMesh.rotation.y = Math.sin(this.elapsed * 3) * 0.2;

            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    _stopLoop() {
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = null;
        }
    }

    _animVillagers(dt) {
        this.villagerMap.forEach(vd => {
            const { mesh, tx, tz, speed, bobOff, waypoints, state } = vd;
            const dx = tx - mesh.position.x;
            const dz = tz - mesh.position.z;
            const dist = Math.hypot(dx, dz);

            if (state === 'walking' && dist > 0.25) {
                // 移动中
                const ms = Math.min(speed * dt, dist);
                mesh.position.x += (dx / dist) * ms;
                mesh.position.z += (dz / dist) * ms;
                
                // 平滑转向
                const targetRot = Math.atan2(dx, dz);
                let rotDiff = targetRot - mesh.rotation.y;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                mesh.rotation.y += rotDiff * Math.min(1, dt * 8);
                
                // 走路时的弹跳
                mesh.position.y = Math.abs(Math.sin(this.elapsed * 10 + bobOff)) * 0.05;
                vd.idleTimer = 0;
            } else if (dist <= 0.25) {
                // 到达当前路径点
                mesh.position.y = 0;

                // 检查是否有下一个路径点
                if (waypoints && vd.currentWaypoint < waypoints.length - 1) {
                    vd.currentWaypoint++;
                    const nextWp = waypoints[vd.currentWaypoint];
                    vd.tx = nextWp[0];
                    vd.tz = nextWp[1];
                } else {
                    // 到达最终目标
                    vd.state = 'working';
                    vd.workTimer += dt;

                    // 工作时小幅度动作
                    if (vd.workTimer < 5) {
                        // 工作动画：轻微左右摇摆
                        mesh.rotation.y += Math.sin(this.elapsed * 3) * 0.02;
                    } else {
                        // 工作一段时间后，在附近小范围走动
                        vd.idleTimer += dt;
                        if (vd.idleTimer > 2 + Math.random() * 3) {
                            // 在当前位置附近随机移动
                            const nearX = mesh.position.x + (Math.random() - 0.5) * 2;
                            const nearZ = mesh.position.z + (Math.random() - 0.5) * 2;
                            // 限制在村庄范围内
                            const r = Math.hypot(nearX, nearZ);
                            if (r < 11) {
                                vd.tx = nearX;
                                vd.tz = nearZ;
                                vd.waypoints = [[nearX, nearZ]];
                                vd.currentWaypoint = 0;
                                vd.state = 'walking';
                            }
                            vd.idleTimer = 0;
                        }
                    }
                }
            } else {
                // idle 状态
                mesh.position.y = 0;
                vd.idleTimer += dt;
                
                // 空闲时偶尔小幅移动
                if (vd.idleTimer > 4 + Math.random() * 4) {
                    const nearX = mesh.position.x + (Math.random() - 0.5) * 2;
                    const nearZ = mesh.position.z + (Math.random() - 0.5) * 2;
                    const r = Math.hypot(nearX, nearZ);
                    if (r < 11) {
                        vd.tx = nearX;
                        vd.tz = nearZ;
                        vd.waypoints = [[nearX, nearZ]];
                        vd.currentWaypoint = 0;
                        vd.state = 'walking';
                    }
                    vd.idleTimer = 0;
                }
            }
        });
    }

    _animBuildings(dt) {
        this.buildingMap.forEach((grp, key) => {
            // 磨坊风车
            if (key.startsWith('mill') && grp.userData.blades) {
                grp.userData.blades.rotation.z += dt * 1.5;
            }
            // 鱼塘动画
            if (key.startsWith('fishPond')) {
                // 水面波纹
                if (grp.userData.water) {
                    const s = 1 + Math.sin(this.elapsed * 2) * 0.015;
                    grp.userData.water.scale.set(s, s, 1);
                }
                // 水面高光移动
                if (grp.userData.highlight) {
                    grp.userData.highlight.position.x = 0.4 + Math.sin(this.elapsed * 0.5) * 0.15;
                    grp.userData.highlight.position.z = -0.3 + Math.cos(this.elapsed * 0.3) * 0.1;
                }
                // 小鱼游动
                grp.children.forEach(child => {
                    if (child.userData.swimPhase !== undefined) {
                        const phase = this.elapsed * 1.5 + child.userData.swimPhase;
                        const radius = 0.4;
                        child.position.x = Math.cos(phase) * radius;
                        child.position.z = Math.sin(phase) * radius * 0.8;
                        child.rotation.y = phase + Math.PI / 2;
                        // 尾巴摆动
                        if (child.children[1]) {
                            child.children[1].rotation.y = Math.sin(this.elapsed * 10 + child.userData.swimPhase) * 0.3;
                        }
                    }
                });
            }
            // 面包店烟雾
            if (key.startsWith('bakery') && grp.userData.smoke) {
                grp.userData.smoke.children.forEach((s, i) => {
                    const phase = this.elapsed * 0.8 + s.userData.phase;
                    s.position.y = s.userData.baseY + Math.sin(phase) * 0.1 + (phase % 2) * 0.1;
                    s.position.x = Math.sin(phase * 0.5) * 0.05;
                    s.material.opacity = 0.5 - (s.position.y - s.userData.baseY) * 0.15;
                    s.scale.setScalar(1 + (s.position.y - s.userData.baseY) * 0.3);
                });
            }
        });
    }

    _animClouds(dt) {
        this.clouds.forEach((cloud, i) => {
            // 缓慢绕圈移动
            cloud.userData.angle += cloud.userData.speed * dt;
            const r = cloud.userData.radius;
            cloud.position.x = Math.cos(cloud.userData.angle) * r;
            cloud.position.z = Math.sin(cloud.userData.angle) * r;
            
            // 轻微上下浮动
            cloud.position.y = 14 + Math.sin(this.elapsed * 0.3 + i * 2) * 1.5;
        });
    }

    _animDecorations(dt) {
        // 花朵轻微摇曳
        this.flowers.forEach((flower, i) => {
            flower.rotation.z = Math.sin(this.elapsed * 2 + i) * 0.08;
            flower.rotation.x = Math.cos(this.elapsed * 1.5 + i * 0.5) * 0.05;
        });

        // 星星闪烁
        if (this.stars && this.stars.visible) {
            const opacity = 0.6 + Math.sin(this.elapsed * 3) * 0.3;
            this.stars.material.opacity = opacity;
        }
    }

    _resize() {
        if (!this.container || !this.renderer || !this.camera) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    dispose() {
        this._stopLoop();
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
        this.scene = null;
    }
}
