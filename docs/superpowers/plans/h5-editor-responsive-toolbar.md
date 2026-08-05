# H5 编辑器工具栏底部布局实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Chrome DevTools 设备模拟器移动预览模式下，将编辑器工具栏从左侧边栏移动到画布下方、TabBar 上方

**Architecture:** 使用 SCSS 媒体查询检测移动设备预览模式（max-width: 800px + orientation: portrait），通过调整 flex-direction 和定位实现响应式布局切换

**Tech Stack:** Vue 3 + Taro + SCSS + Flexbox 响应式布局

---

## 文件结构分析

### 核心修改文件：
1. **`src/pages/editor/index.vue`** - 主编辑器页面模板结构
2. **`src/pages/editor/index.scss`** - 编辑器页面样式，需添加响应式媒体查询
3. **`src/pages/editor/components/toolArea/index.scss`** - 工具栏组件样式优化

### 设计思路：
- 桌面模式（width > 800px）：保持现有左侧边栏布局
- 移动模式（width ≤ 800px + portrait）：
  - `.editor-body` 改为 `flex-direction: column-reverse`
  - 工具栏位于顶部但通过 `order` 或 `column-reverse` 到底部
  - 隐藏非核心的调色板区域
  - 工具栏横向排列、居中显示

---

## Task 1: 修改主编辑器页面结构

**Files:**
- Modify: `src/pages/editor/index.vue`

- [ ] **Step 1: 调整 template 结构以支持响应式布局**

在 `.editor-body` 中，保持 ToolArea 和 DrawPanel 的顺序不变，通过 CSS 的 `flex-direction: column-reverse` 来控制视觉顺序。

```vue
<!-- 在现有的 editor-body 部分不需要改动 HTML 结构 -->
<view class="editor-body">
  <!-- ToolArea 保持在 DOM 中的第一个位置 -->
  <ToolArea ... />
  
  <!-- DrawPanel 保持在 DOM 中的第二个位置 -->
  <view class="canvas-wrapper" id="canvasWrapper">
    <DrawPanel ... />
  </view>
</view>
```

**说明：** 不需要修改模板结构，只需通过 CSS 实现响应式即可。

- [ ] **Step 2: 保存并验证当前结构**

```bash
# 无需运行命令，直接保存文件
git add src/pages/editor/index.vue
git commit -m "refactor: prepare editor structure for responsive layout"
```

---

## Task 2: 添加响应式媒体查询到编辑器主样式

**Files:**
- Modify: `src/pages/editor/index.scss`

- [ ] **Step 1: 在 SCSS 末尾添加移动端响应式布局规则**

在文件末尾（第 59 行之后）添加以下代码：

```scss
// ============================================
// H5 设备模拟器优化 - 工具栏底部布局
// 当切换到移动设备预览模式时（≤800px 竖屏）
// ============================================
@media screen and (max-width: 800px) and (orientation: portrait) {
  .editor-page {
    padding-left: 0; /* 移除左侧边栏间距 */
  }
  
  .editor-body {
    flex-direction: column-reverse; /* 反转布局顺序 */
    min-height: calc(100vh - 60px); /* 计算合理的最小高度 */
  }
  
  .tool-area {
    width: 100%; /* 占满整个宽度 */
    order: 1; /* 确保在正确位置 */
    
    &.color-picker-section,
    &.grid-size-section {
      display: none; /* 移动端隐藏这些区域 */
    }
  }
  
  .canvas-wrapper {
    order: 2; /* 画布在上层 */
    flex: 1;
    margin-bottom: 60px; /* 与底部工具栏保持间距 */
  }
}
```

- [ ] **Step 2: 运行 Sass 编译验证语法正确性**

```bash
# 如果是开发环境，运行构建命令检查是否有编译错误
npm run build:h5
```

Expected: 编译成功，无错误

- [ ] **Step 3: 提交更改**

```bash
git add src/pages/editor/index.scss
git commit -m "style: add responsive layout for mobile device simulator"
```

---

## Task 3: 优化工具栏组件样式

**Files:**
- Modify: `src/pages/editor/components/toolArea/index.scss`

- [ ] **Step 1: 查看现有样式结构**

打开 `src/pages/editor/components/toolArea/index.scss`，找到第 149-174 行的媒体查询部分。

- [ ] **Step 2: 更新工具栏在移动端下的样式**

在现有的媒体查询块中添加/修改以下规则：

```scss
@media screen and (max-width: 800px) and (orientation: portrait) {
  // ... existing styles ...
  
  // 新增：工具栏容器样式
  .tool-area {
    position: fixed;
    bottom: 60px; /* TabBar 上方 60px */
    left: 0;
    right: 0;
    background-color: $background-color-white;
    box-shadow: 0 -2px 8px rgba($border-color-dark, 0.1);
    z-index: 100;
    padding: 10px 0;
  }
  
  // 工具栏横排布局
  .tool-bar {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    gap: 12px;
    overflow-x: auto;
    max-width: 100vw;
  }
  
  // 工具项样式优化
  .tool-item {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    background-color: $background-color-gray;
    transition: all 0.2s ease;
    
    &.active {
      background-color: $primary-color;
      box-shadow: 0 0 0 2px rgba($border-color-light, 0.5);
    }
  }
  
  // 工具标签样式
  .tool-label {
    font-size: 10px;
    line-height: 1.2;
    display: block;
    margin-top: 4px;
  }
  
  // 工具包裹器
  .tool-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    min-width: 64px;
  }
}
```

- [ ] **Step 3: 验证 Sass 编译**

```bash
npm run build:h5
```

Expected: 编译成功

- [ ] **Step 4: 提交更改**

```bash
git add src/pages/editor/components/toolArea/index.scss
git commit -m "style: optimize tool area layout for mobile preview mode"
```

---

## Task 4: 优化 Canvas 包装器样式

**Files:**
- Modify: `src/pages/editor/index.scss`

- [ ] **Step 1: 添加 Canvas 包装器的移动端优化**

在 Task 2 添加的媒体查询块内追加：

```scss
.canvas-wrapper {
  position: relative;
  width: 100%;
  max-width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin-bottom: 70px; /* 预留工具栏空间 */
}

.draw-panel {
  touch-action: none; /* 优化触摸交互 */
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build:h5
```

- [ ] **Step 3: 提交更改**

```bash
git commit -am "style: optimize canvas wrapper for mobile device simulator"
```

---

## Task 5: 测试与验证

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev:h5
```

- [ ] **Step 2: 打开 Chrome DevTools**

1. 按 `F12` 或 `Ctrl+Shift+I` 打开开发者工具
2. 点击设备模拟器图标（或按 `Ctrl+Shift+M`）
3. 选择一个移动设备预设（如 iPhone 12 Pro）
4. 刷新页面

- [ ] **Step 3: 验证布局效果**

Expected Results:
- ✅ 工具栏位于画布下方
- ✅ TabBar 位于页面最底部
- ✅ 工具栏横向排列，可滚动
- ✅ 工具栏有阴影和背景色区分
- ✅ 画布占据主要可视区域
- ✅ 工具图标在选中状态下有正确的高亮样式

- [ ] **Step 4: 桌面模式验证**

调整窗口宽度超过 800px，验证：
- ✅ 工具栏恢复到左侧边栏模式
- ✅ 布局符合原始设计要求

- [ ] **Step 5: 如果全部通过，提交最终更改**

```bash
git add .
git commit -m "feat: complete responsive layout for H5 editor in device simulator"
```

---

## Self-Review Checklist

✅ **Spec coverage:** 所有任务都覆盖了用户需求的"工具栏移动到画布下方、TabBar 上方"

✅ **Placeholder scan:** 没有发现 TODO、TBD 等占位符

✅ **Type consistency:** 纯样式修改，不涉及类型定义

✅ **Syntax validation:** 所有 SCSS 代码块都已闭合花括号

---

**Plan complete and saved to `docs/superpowers/plans/YYYY-MM-DD-h5-editor-responsive-toolbar.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 我为每个任务派生一个子代理，任务之间进行审查，快速迭代

**2. Inline Execution** - 在本会话中使用 executing-plans 技能执行任务，带检查点的批量执行

**Which approach?**
