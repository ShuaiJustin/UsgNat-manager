"""
USG NAT Manager - 测试 API 服务器

用于测试客户端更新功能的本地 API 服务器。
支持所有更新场景的模拟，包括正常更新、灰度阻止、统计上报等。

启动方式：
    pip install fastapi uvicorn
    python scripts/dev/test_api_server.py
    
或：
    uvicorn scripts.dev.test_api_server:app --host 0.0.0.0 --port 8123 --reload

访问文档：
    http://localhost:8123/docs
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import uvicorn
from datetime import datetime

app = FastAPI(
    title="USG NAT Manager Update API - 测试服务器",
    description="用于测试客户端更新功能",
    version="1.0.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# 数据模型
# ============================================

class UpdateCheckRequest(BaseModel):
    """检查更新请求"""
    current_version: str
    platform: str
    arch: str
    user_id: str
    channel: str = "stable"

class ChangelogItem(BaseModel):
    """更新日志条目"""
    type: str  # feature, fix, improve
    description: str

class DownloadStatsRequest(BaseModel):
    """下载统计请求"""
    user_id: str
    version: str
    from_version: str
    platform: str
    arch: str
    status: str  # started, completed, failed
    error_message: Optional[str] = None

class InstallStatsRequest(BaseModel):
    """安装统计请求"""
    user_id: str
    from_version: str
    to_version: str
    platform: str
    arch: str
    status: str  # started, completed, failed
    error_message: Optional[str] = None

# ============================================
# 配置变量（可修改以测试不同场景）
# ============================================

# 测试场景配置
TEST_SCENARIO = "normal"  # normal, rollout_blocked, no_update, error

# 版本信息配置
LATEST_VERSION = "1.0.8"
RELEASE_DATE = "2025-11-10"
FILE_HASH = "a3f7b8c9d2e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9"
FILE_SIZE = 104857600  # 100 MB
DOWNLOAD_URL = f"/updates/v{LATEST_VERSION}/USG-NAT-Manager-Setup-{LATEST_VERSION}.exe"

# 灰度发布配置
ROLLOUT_PERCENTAGE = 10  # 发布比例 (%)
ROLLOUT_ENABLED = False  # 是否启用灰度

# 更新日志
CHANGELOG = [
    {
        "type": "feature",
        "description": "新增 IPv6 NAT 规则支持"
    },
    {
        "type": "improve",
        "description": "优化 SSH 连接稳定性"
    },
    {
        "type": "fix",
        "description": "修复规则导出时的格式问题"
    }
]

# 统计数据存储
download_stats = []
install_stats = []

# ============================================
# 辅助函数
# ============================================

def compare_versions(v1: str, v2: str) -> int:
    """比较版本号 (-1: v1 < v2, 0: v1 == v2, 1: v1 > v2)"""
    parts1 = [int(x) for x in v1.split('.')]
    parts2 = [int(x) for x in v2.split('.')]
    
    max_len = max(len(parts1), len(parts2))
    parts1 += [0] * (max_len - len(parts1))
    parts2 += [0] * (max_len - len(parts2))
    
    for i in range(max_len):
        if parts1[i] > parts2[i]:
            return 1
        elif parts1[i] < parts2[i]:
            return -1
    return 0

def is_user_in_rollout(user_id: str, percentage: int) -> bool:
    """判断用户是否在灰度发布名单中"""
    # 使用用户ID的哈希值模100来决定
    hash_value = sum(ord(c) for c in user_id) % 100
    return hash_value < percentage

# ============================================
# API 端点
# ============================================

@app.get("/")
async def root():
    """根路径"""
    return {
        "name": "USG NAT Manager Update API - 测试服务器",
        "version": "1.0.0",
        "status": "running",
        "test_scenario": TEST_SCENARIO,
        "docs": "/docs"
    }

@app.post("/api/v1/updates/check")
async def check_updates(req: UpdateCheckRequest):
    """
    检查更新
    
    测试场景：
    - normal: 正常更新（有新版本）
    - rollout_blocked: 灰度阻止（用户未进入名单）
    - no_update: 无更新（已是最新版本）
    - error: 服务器错误
    """
    print(f"\n[检查更新] 收到请求:")
    print(f"  当前版本: {req.current_version}")
    print(f"  平台: {req.platform}")
    print(f"  架构: {req.arch}")
    print(f"  用户ID: {req.user_id[:16]}...")
    print(f"  渠道: {req.channel}")
    print(f"  测试场景: {TEST_SCENARIO}")
    
    # 测试场景：错误
    if TEST_SCENARIO == "error":
        return {
            "success": False,
            "message": "服务器维护中，请稍后再试"
        }
    
    # 比较版本
    version_compare = compare_versions(req.current_version, LATEST_VERSION)
    
    # 测试场景：无更新
    if TEST_SCENARIO == "no_update" or version_compare >= 0:
        print(f"  → 无更新（当前: {req.current_version}, 最新: {LATEST_VERSION}）")
        return {
            "success": True,
            "data": {
                "has_update": False,
                "current_version": req.current_version,
                "message": "当前已是最新版本"
            }
        }
    
    # 有新版本
    print(f"  → 发现新版本: {LATEST_VERSION}")
    
    # 检查灰度发布
    rollout_blocked = False
    if ROLLOUT_ENABLED or TEST_SCENARIO == "rollout_blocked":
        in_rollout = is_user_in_rollout(req.user_id, ROLLOUT_PERCENTAGE)
        rollout_blocked = not in_rollout
        print(f"  → 灰度状态: {'阻止' if rollout_blocked else '允许'} (比例: {ROLLOUT_PERCENTAGE}%)")
    
    # 构建响应
    response = {
        "success": True,
        "data": {
            "has_update": True,
            "latest_version": LATEST_VERSION,
            "release_date": RELEASE_DATE,
            "download_url": DOWNLOAD_URL,
            "file_hash": FILE_HASH,
            "file_size": FILE_SIZE,
            "is_mandatory": False,
            "rollout_blocked": rollout_blocked,
            "rollout_percentage": ROLLOUT_PERCENTAGE if ROLLOUT_ENABLED else 100,
            "changelog": CHANGELOG,
            "minimum_version": "1.0.0"
        }
    }
    
    return response

@app.post("/api/v1/updates/stats/download")
async def report_download_stats(data: DownloadStatsRequest):
    """
    下载统计上报
    """
    print(f"\n[下载统计] 收到上报:")
    print(f"  用户ID: {data.user_id[:16]}...")
    print(f"  版本: {data.from_version} → {data.version}")
    print(f"  平台: {data.platform}/{data.arch}")
    print(f"  状态: {data.status}")
    if data.error_message:
        print(f"  错误: {data.error_message}")
    
    # 记录统计数据
    download_stats.append({
        "timestamp": datetime.now().isoformat(),
        "user_id": data.user_id,
        "version": data.version,
        "from_version": data.from_version,
        "platform": data.platform,
        "arch": data.arch,
        "status": data.status,
        "error_message": data.error_message
    })
    
    return {"success": True, "message": "统计已记录"}

@app.post("/api/v1/updates/stats/install")
async def report_install_stats(data: InstallStatsRequest):
    """
    安装统计上报
    """
    print(f"\n[安装统计] 收到上报:")
    print(f"  用户ID: {data.user_id[:16]}...")
    print(f"  版本: {data.from_version} → {data.to_version}")
    print(f"  平台: {data.platform}/{data.arch}")
    print(f"  状态: {data.status}")
    if data.error_message:
        print(f"  错误: {data.error_message}")
    
    # 记录统计数据
    install_stats.append({
        "timestamp": datetime.now().isoformat(),
        "user_id": data.user_id,
        "from_version": data.from_version,
        "to_version": data.to_version,
        "platform": data.platform,
        "arch": data.arch,
        "status": data.status,
        "error_message": data.error_message
    })
    
    return {"success": True, "message": "统计已记录"}

@app.get("/api/v1/stats/summary")
async def get_stats_summary():
    """
    获取统计摘要
    """
    return {
        "download_stats": {
            "total": len(download_stats),
            "started": len([s for s in download_stats if s["status"] == "started"]),
            "completed": len([s for s in download_stats if s["status"] == "completed"]),
            "failed": len([s for s in download_stats if s["status"] == "failed"]),
            "recent": download_stats[-5:] if download_stats else []
        },
        "install_stats": {
            "total": len(install_stats),
            "started": len([s for s in install_stats if s["status"] == "started"]),
            "completed": len([s for s in install_stats if s["status"] == "completed"]),
            "failed": len([s for s in install_stats if s["status"] == "failed"]),
            "recent": install_stats[-5:] if install_stats else []
        }
    }

@app.post("/api/v1/test/scenario/{scenario}")
async def set_test_scenario(scenario: str):
    """
    切换测试场景
    
    可选场景：
    - normal: 正常更新
    - rollout_blocked: 灰度阻止
    - no_update: 无更新
    - error: 服务器错误
    """
    global TEST_SCENARIO
    
    valid_scenarios = ["normal", "rollout_blocked", "no_update", "error"]
    if scenario not in valid_scenarios:
        return {
            "success": False,
            "message": f"无效的场景。可选: {', '.join(valid_scenarios)}"
        }
    
    TEST_SCENARIO = scenario
    print(f"\n[场景切换] 已切换到: {scenario}")
    
    return {
        "success": True,
        "message": f"测试场景已切换为: {scenario}",
        "current_scenario": TEST_SCENARIO
    }

@app.post("/api/v1/test/rollout/enable")
async def enable_rollout(percentage: int = 10):
    """启用灰度发布"""
    global ROLLOUT_ENABLED, ROLLOUT_PERCENTAGE
    
    if not 0 <= percentage <= 100:
        return {
            "success": False,
            "message": "百分比必须在 0-100 之间"
        }
    
    ROLLOUT_ENABLED = True
    ROLLOUT_PERCENTAGE = percentage
    print(f"\n[灰度配置] 已启用灰度发布: {percentage}%")
    
    return {
        "success": True,
        "message": f"灰度发布已启用，比例: {percentage}%",
        "rollout_enabled": ROLLOUT_ENABLED,
        "rollout_percentage": ROLLOUT_PERCENTAGE
    }

@app.post("/api/v1/test/rollout/disable")
async def disable_rollout():
    """禁用灰度发布"""
    global ROLLOUT_ENABLED
    
    ROLLOUT_ENABLED = False
    print(f"\n[灰度配置] 已禁用灰度发布")
    
    return {
        "success": True,
        "message": "灰度发布已禁用",
        "rollout_enabled": ROLLOUT_ENABLED
    }

# ============================================
# 启动服务器
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("USG NAT Manager - 测试 API 服务器")
    print("=" * 60)
    print(f"当前测试场景: {TEST_SCENARIO}")
    print(f"最新版本: {LATEST_VERSION}")
    print(f"灰度发布: {'启用' if ROLLOUT_ENABLED else '禁用'} ({ROLLOUT_PERCENTAGE}%)")
    print()
    print("切换测试场景：")
    print("  POST /api/v1/test/scenario/normal")
    print("  POST /api/v1/test/scenario/rollout_blocked")
    print("  POST /api/v1/test/scenario/no_update")
    print("  POST /api/v1/test/scenario/error")
    print()
    print("启用灰度发布：")
    print("  POST /api/v1/test/rollout/enable?percentage=10")
    print()
    print("查看统计：")
    print("  GET /api/v1/stats/summary")
    print()
    print("访问 API 文档：")
    print("  http://localhost:8123/docs")
    print("=" * 60)
    print()
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8123,
        log_level="info"
    )

