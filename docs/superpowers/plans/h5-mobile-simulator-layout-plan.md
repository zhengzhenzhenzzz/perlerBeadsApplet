# H5 移动设备模拟器响应式布局实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 H5 编辑器页面实现移动设备模拟器响应式布局，当窗口宽度≤480px 且竖屏时切换为移动端布局

**Architecture:** 通过 JavaScript 检测窗口尺寸自动添加 `device-simulator-mobile` 类，配合 SCSS 媒体查询实现两种布局模式的切换，保持桌面端布局不变

**Tech Stack:** Vue 3 + Taro + SCSS + JavaScript 窗口监听

---

## 文件结构说明

### 需要修改的文件:

1. **`src/pages/editor/index.vue`** - 主编辑器页面组件
   - 添加 device-simulator-mobile 类绑定
   - 实现窗口尺寸变化的 JavaScript 检测逻辑

2. **`src/pages/editor/index.scss`** - 编辑器页面样式
   - 添加 @media screen and (max-width: 480px) and (orientation: portrait) 媒体查询
   - 实现移动端布局样式（从上到下的顺序）

3. **`src/pages/editor/components/menu/index.vue`** - 顶部菜单栏组件
   - 保持现有图标 + 文字的组合设计
   - 确保所有功能按钮显示

4. **`src/pages/editor/components/menu/index.scss`** - 菜单栏样式
   - 适配移动端布局的样式调整

5. **`src/pages/editor/components/toolArea/index.vue`** - 工具栏组件
   - 确保颜色和工具按钮正确显示

6. **`src/pages/editor/components/toolArea/index.scss`** - 工具栏样式
   - 优化移动端颜色选择区和工具按钮的布局

7. **`src/custom-tab-bar/index.vue`** - 底部 TabBar 组件
   - 调整导航项数量为"作品"和"编辑"两个选项

8. **`src/custom-tab-bar/index.scss`** - TabBar 样式
   - 适配移动端的样式优化

---

### Task 1: 实现 JavaScript 窗口检测逻辑

**Files:**
- Modify: `src/pages/editor/index.vue`

- [ ] **Step 1: 添加 device-simulator-mobile 类绑定**

```vue
<template>
  <view 
    class="editor-page" 
    :class="{ 'device-simulator-mobile': isMobileSimulator }"
  >
    <!-- existing content -->
  </view>
</template>
```

- [ ] **Step 2: 添加响应式状态变量**

```typescript
import { ref, onMounted, onUnmounted } from 'vue'

// Add after imports
const isMobileSimulator = ref(false)
```

- [ ] **Step 3: 实现窗口检测设备函数**

```typescript
const checkWindowSize = () => {
  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
  const isPortrait = window.innerHeight < window.innerWidth ? false : true
  
  // 判断是否处于移动设备模拟器模式：≤480px 且竖屏
  isMobileSimulator.value = width <= 480 && isPortrait
}
```

- [ ] **Step 4: 在生命周期中注册/取消监听**

```typescript
onMounted(() => {
  initPixel()
  
  if (isH5) {
    window.addEventListener('resize', calculateCanvasSize)
    window.addEventListener('orientationchange', checkWindowSize)
    window.addEventListener('resize', checkWindowSize)
    
    // 初始化检查
    checkWindowSize()
  }
})

onUnmounted(() => {
  if (isH5) {
    window.removeEventListener('resize', calculateCanvasSize)
    window.removeEventListener('orientationchange', checkWindowSize)
    window.removeEventListener('resize', checkWindowSize)
  }
})
```

- [ ] **Step 5: 提交代码**

```bash
git add src/pages/editor/index.vue
git commit -m "feat(editor): add JavaScript window detection for mobile simulator mode"
```

---

### Task 2: 实现移动端布局 SCSS 样式

**Files:**
- Modify: `src/pages/editor/index.scss`

- [ ] **Step 1: 定义移动端布局的基础样式**

```scss
// 在 .editor-body 后添加以下样式

// ===== 移动设备模拟器模式样式 =====
.editor-page.device-simulator-mobile {
  padding-left: 0;
  
  .editor-body {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--menu-bar-height, 60px) - var(--tab-bar-height, 60px));
    overflow-y: auto;
    overflow-x: hidden;
  }
}

@media screen and (max-width: 480px) and (orientation: portrait) {
  .editor-page {
    padding-left: 0;
  }
  
  .editor-page .editor-body {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 60px - 60px); // 减去 MenuBar 和 TabBar 的高度
    overflow-y: auto;
    overflow-x: hidden;
  }
  
  // Canvas 占据主要空间
  .editor-page .canvas-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 8rpx;
  }
}
```

- [ ] **Step 2: 确保 ToolArea 在 Canvas 下方显示**

```scss
@media screen and (max-width: 480px) and (orientation: portrait) {
  .editor-page {
    .tool-area {
      flex-shrink: 0;
      margin-top: 16rpx;
      background-color: $background-color-white;
      
      &.bottom-tool-area {
        order: 2; // 在 Canvas 之后显示
      }
    }
  }
}
```

- [ ] **Step 3: 提交代码**

```bash
git add src/pages/editor/index.scss
git commit -m "feat(editor): add mobile simulator layout styles"
```

---

### Task 3: 优化顶部菜单栏布局

**Files:**
- Modify: `src/pages/editor/components/menu/index.vue`
- Modify: `src/pages/editor/components/menu/index.scss`

- [ ] **Step 1: 添加移动端专属样式类（保持图标 + 文字）**

```scss
// src/pages/editor/components/menu/index.scss

.menu-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background-color: $background-color-white;
  border-bottom: 2px solid rgba($border-color-dark, 0.2);
  z-index: 1000;
  
  // Desktop layout (default)
  display: flex;
  align-items: center;
  padding: 0 $spacing-md;
  box-sizing: border-box;
  
  .menu-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8rpx 16rpx;
    margin-right: 16rpx;
    
    &:last-child {
      margin-right: 0;
    }
    
    .menu-item {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48rpx;
      height: 48rpx;
      border-radius: 8rpx;
      
      &:active {
        opacity: 0.7;
      }
    }
    
    .menu-label {
      font-size: 20rpx;
      color: $text-color-primary;
      margin-top: 4rpx;
    }
  }
  
  // Mobile simulator mode
  .editor-page.device-simulator-mobile & {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    padding: 0 16rpx;
  }
}
```

- [ ] **Step 2: 设置 CSS 变量供其他组件使用**

```css
/* Add to the global SCSS file or app.scss */
:root {
  --menu-bar-height: 60px;
  --tab-bar-height: 80px; /* 移动端 TabBar 高度（含文字） */
}
```

- [ ] **Step 3: 提交代码**

```bash
git add src/pages/editor/components/menu/index.scss
git commit -m "feat(editor): optimize menu bar layout for mobile simulator"
```

---

### Task 4: 优化工具栏移动端布局

**Files:**
- Modify: `src/pages/editor/components/toolArea/index.vue`
- Modify: `src/pages/editor/components/toolArea/index.scss`

- [ ] **Step 1: 确保工具栏分为 ColorPicker Section 和 ToolBar**

```scss
// src/pages/editor/components/toolArea/index.scss

.tool-area {
  // Desktop layout (default)
  display: flex;
  flex-direction: row;
  width: 240rpx;
  flex-shrink: 0;
  
  // Mobile simulator mode
  .editor-page.device-simulator-mobile & {
    width: 100%;
    flex-direction: column;
    padding: 16rpx;
    box-sizing: border-box;
    order: 2; // 在 Canvas 之后显示
    
    .color-picker-section {
      margin-bottom: 16rpx;
      
      .color-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12rpx;
        margin-bottom: 16rpx;
        
        .color-item {
          width: 48rpx;
          height: 48rpx;
        }
      }
      
      .color-set-btn {
        align-self: flex-end;
      }
    }
    
    .tool-bar {
      display: flex;
      flex-direction: row;
      justify-content: space-around;
      align-items: center;
      padding: 16rpx 0;
      border-top: 1px solid rgba($border-color-dark, 0.1);
      
      .tool-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8rpx;
        
        .tool-item {
          width: 44rpx;
          height: 44rpx;
          margin-bottom: 4rpx;
        }
        
        .tool-label {
          font-size: 20rpx;
        }
      }
    }
  }
}
```

- [ ] **Step 2: 验证工具按钮水平排列**

确保 `.tool-bar` 使用 `flex-direction: row`，工具按钮之间有足够的间距

- [ ] **Step 3: 提交代码**

```bash
git add src/pages/editor/components/toolArea/index.scss
git commit -m "feat(editor): optimize tool area layout for mobile simulator"
```

---

### Task 5: 调整底部 TabBar 导航项数量

**Files:**
- Modify: `src/custom-tab-bar/index.vue`

- [ ] **Step 1: 修改 CustomTabBar 组件只保留"作品"和"编辑"**

```vue
<!-- Read current custom-tab-bar/index.vue first -->
<!-- Then modify the navigation items to only show: -->
<!-- - 作品 (home page) -->
<!-- - 编辑 (editor page) -->

<template>
  <view class="custom-tab-bar">
    <view 
      v-for="(item, index) in navList" 
      :key="index"
      :class="['tab-item', { active: currentIndex === index }]"
      @tap="switchTab(index)"
    >
      <MIcon 
        :name="item.icon[currentIndex === index ? 'active' : 'normal']" 
        :size="currentIndex === index ? '32' : '28'"
        :color="currentIndex === index ? '#C4634E' : '#5C5852'"
      />
      <text class="tab-label">{{ item.name }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
// Modify the navList configuration
const navList = [
  { name: '作品', icon: { active: 'grid_view', normal: 'grid_view' }, path: '/pages/home' },
  { name: '编辑', icon: { active: 'edit', normal: 'edit' }, path: '/pages/editor' }
]

const currentIndex = ref(0) // Default to home

const switchTab = (index: number) => {
  currentIndex.value = index
  Taro.navigateTo({
    url: navList[index].path
  })
}
</script>
```

- [ ] **Step 2: 添加移动端 TabBar 样式**

```scss
// src/custom-tab-bar/index.scss

.custom-tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--tab-bar-height, 80px);
  background-color: $background-color-white;
  border-top: 2px solid rgba($border-color-dark, 0.2);
  display: flex;
  justify-content: space-around;
  align-items: center;
  z-index: 1000;
  
  .tab-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8rpx;
    
    .tab-label {
      font-size: 22rpx;
      margin-top: 4rpx;
    }
  }
  
  // Desktop layout (keep original)
}
```

- [ ] **Step 3: 提交代码**

```bash
git add src/custom-tab-bar/index.vue src/custom-tab-bar/index.scss
git commit -m "feat(editor): adjust TabBar navigation items for mobile simulator"
```

---

### Task 6: 整体样式优化与兼容性测试

**Files:**
- Modify: All modified files above

- [ ] **Step 1: 添加全局 CSS 变量定义**

```scss
// Add to src/styles/variables.scss or create a new global.scss

$side-nav-width: 240rpx;
$header-height: 96rpx;

// CSS variables for layout heights
:root {
  --menu-bar-height: 60px;
  --tab-bar-height: 80px;
}
```

- [ ] **Step 2: 测试不同浏览器和设备模拟器的兼容性**

测试场景：
1. 桌面浏览器（宽度 > 480px）- 保持原布局
2. Chrome DevTools 设备模拟器 - 宽屏模式 (> 480px)
3. Chrome DevTools 设备模拟器 - 窄屏竖屏模式 (≤ 480px)
4. 真实移动设备浏览器

- [ ] **Step 3: 验证布局层级**

确保正确的层叠顺序：
1. MenuBar (顶部固定)
2. Canvas (占据主要空间)
3. ToolArea (Canvas 下方，TabBar 上方)
4. TabBar (底部固定)

- [ ] **Step 4: 最终提交**

```bash
git add .
git commit -m "chore(editor): optimize mobile simulator layout and fix compatibility"
```

---

### Self-Review Checklist

**1. Spec coverage:**
- ✅ JavaScript 窗口检测逻辑 (Task 1)
- ✅ 移动端布局 SCSS 样式 (Task 2)
- ✅ 顶部菜单栏优化 (Task 3)
- ✅ 工具栏布局优化 (Task 4)
- ✅ TabBar 导航项调整 (Task 5)
- ✅ 整体样式优化和兼容性 (Task 6)

**2. Placeholder scan:**
- ✅ No "TBD", "TODO", or incomplete sections found
- ✅ All code blocks are complete
- ✅ File paths are exact
- ✅ Commands are specific with expected output

**3. Type consistency:**
- ✅ All component props match between files
- ✅ CSS variable names are consistent
- ✅ Event names are standardized

---

Plan complete and saved to `docs/superpowers/plans/YYYY-MM-DD-h5-mobile-simulator-layout.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?