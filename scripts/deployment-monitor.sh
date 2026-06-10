#!/bin/bash
# 部署监控脚本 - 10 分钟监控一次，失败时检查根因
# 用法: ./deployment-monitor.sh <project-path> <version> [max-checks]



PROJECT_PATH=$1
VERSION=$2
MAX_CHECKS=${3:-30}  # 默认最多检查 30 次（5 小时）

if [ -z "$PROJECT_PATH" ] || [ -z "$VERSION" ]; then
    echo "用法: $0 <project-path> <version> [max-checks]"
    echo "示例: $0 /path/to/project v1.0.0 30"
    exit 1
fi

cd "$PROJECT_PATH"

echo "=========================================="
echo "部署监控开始"
echo "=========================================="
echo "项目路径: $PROJECT_PATH"
echo "版本: $VERSION"
echo "最大检查次数: $MAX_CHECKS"
echo "检查间隔: 10 分钟"
echo "=========================================="

# 日志文件
LOG_FILE=".deployment-monitor.log"
RESULTS_FILE=".deployment-results.json"

# 初始化结果文件
cat > "$RESULTS_FILE" << EOF
{
  "version": "$VERSION",
  "start_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "checks": [],
  "status": "monitoring",
  "final_result": null
}
EOF

# 检查函数
check_deployment_status() {
    local check_num=$1
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    echo ""
    echo "🔍 检查 #$check_num - $timestamp"
    echo "----------------------------------------"
    
    # 记录到日志
    echo "[$timestamp] 开始检查 #$check_num" >> "$LOG_FILE"
    
    # 检查 GitHub Actions 状态
    if command -v gh &> /dev/null; then
        echo "检查 GitHub Actions 状态..."
        
        # 获取最新的 workflow run
        WORKFLOW_INFO=$(gh run list --limit 1 --json databaseId,status,conclusion,headBranch 2>/dev/null || echo "{}")
        
        if [ "$WORKFLOW_INFO" != "{}" ]; then
            WORKFLOW_ID=$(echo "$WORKFLOW_INFO" | jq -r '.[0].databaseId // empty')
            WORKFLOW_STATUS=$(echo "$WORKFLOW_INFO" | jq -r '.[0].status // "unknown"')
            WORKFLOW_CONCLUSION=$(echo "$WORKFLOW_INFO" | jq -r '.[0].conclusion // "pending"')
            WORKFLOW_BRANCH=$(echo "$WORKFLOW_INFO" | jq -r '.[0].headBranch // "unknown"')
            
            echo "Workflow ID: $WORKFLOW_ID"
            echo "状态: $WORKFLOW_STATUS"
            echo "结论: $WORKFLOW_CONCLUSION"
            echo "分支: $WORKFLOW_BRANCH"
            
            # 检查是否完成
            if [ "$WORKFLOW_STATUS" = "completed" ]; then
                if [ "$WORKFLOW_CONCLUSION" = "success" ]; then
                    echo "✅ 部署成功！"
                    return 0
                elif [ "$WORKFLOW_CONCLUSION" = "failure" ]; then
                    echo "❌ 部署失败"
                    return 1
                elif [ "$WORKFLOW_CONCLUSION" = "cancelled" ]; then
                    echo "⚠️ 部署被取消"
                    return 2
                fi
            else
                echo "⏳ 部署进行中..."
                return 3
            fi
        else
            echo "⚠ 无法获取 GitHub Actions 信息"
            return 3
        fi
    else
        echo "⚠ 未安装 GitHub CLI (gh)"
        return 3
    fi
}

# 检查根因函数
check_failure_root_cause() {
    local workflow_id=$1
    
    echo ""
    echo "🔍 检查失败根因"
    echo "----------------------------------------"
    
    if [ -z "$workflow_id" ]; then
        echo "⚠ 无法获取 workflow ID"
        return
    fi
    
    # 获取 workflow 详情
    echo "获取 workflow 详情..."
    gh run view "$workflow_id" --json jobs,conclusion,failureReason 2>/dev/null || echo "⚠ 无法获取详情"
    
    # 获取失败的 job
    echo ""
    echo "失败的 Job:"
    gh run view "$workflow_id" --json jobs | jq -r '.jobs[] | select(.conclusion == "failure") | "  - \(.name): \(.conclusion)"' 2>/dev/null || echo "  无法获取"
    
    # 获取失败步骤的日志
    echo ""
    echo "失败步骤日志:"
    gh run view "$workflow_id" --log-failed 2>/dev/null | tail -50 || echo "  无法获取日志"
    
    # 常见失败原因分析
    echo ""
    echo "📊 常见失败原因分析:"
    echo "1. 依赖安装失败 - 检查 package.json/requirements.txt"
    echo "2. 测试失败 - 检查测试代码和测试环境"
    echo "3. 构建失败 - 检查构建脚本和配置"
    echo "4. 部署失败 - 检查部署配置和权限"
    echo "5. 超时 - 检查网络或增加超时时间"
    echo "6. 环境变量缺失 - 检查 GitHub Secrets"
    
    # 尝试自动诊断
    echo ""
    echo "🔧 自动诊断:"
    
    # 检查是否有常见的错误模式
    LOGS=$(gh run view "$workflow_id" --log 2>/dev/null || echo "")
    
    if echo "$LOGS" | grep -q "npm ERR!"; then
        echo "  - 发现 npm 错误，可能是依赖问题"
    fi
    
    if echo "$LOGS" | grep -q "pytest.*FAILED"; then
        echo "  - 发现测试失败，需要修复测试"
    fi
    
    if echo "$LOGS" | grep -q "error: "; then
        echo "  - 发现编译错误，需要修复代码"
    fi
    
    if echo "$LOGS" | grep -q "Permission denied"; then
        echo "  - 发现权限问题，检查 GitHub Secrets"
    fi
    
    if echo "$LOGS" | grep -q "timeout"; then
        echo "  - 发现超时，可能需要优化或增加超时时间"
    fi
}

# 更新结果文件
update_results() {
    local check_num=$1
    local status=$2
    local details=$3
    
    # 使用 jq 更新 JSON（如果可用）
    if command -v jq &> /dev/null; then
        local temp_file=$(mktemp)
        jq --arg num "$check_num" \
           --arg time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
           --arg status "$status" \
           --arg details "$details" \
           '.checks += [{"check": ($num | tonumber), "time": $time, "status": $status, "details": $details}]' \
           "$RESULTS_FILE" > "$temp_file" && mv "$temp_file" "$RESULTS_FILE"
    fi
}

# 主监控循环
main_monitor() {
    local check_count=0
    local success=false
    local failed=false
    
    while [ $check_count -lt $MAX_CHECKS ]; do
        check_count=$((check_count + 1))
        
        # 执行检查
        check_deployment_status $check_count
        local result=$?
        
        # 更新结果
        update_results $check_count "check_$result" "检查完成"
        
        # 处理结果
        case $result in
            0)  # 成功
                success=true
                break
                ;;
            1)  # 失败
                failed=true
                echo ""
                echo "❌ 部署失败，开始检查根因..."
                
                # 获取 workflow ID
                if command -v gh &> /dev/null; then
                    WORKFLOW_ID=$(gh run list --limit 1 --json databaseId | jq -r '.[0].databaseId // empty')
                    check_failure_root_cause "$WORKFLOW_ID"
                fi
                
                echo ""
                echo "💡 建议的修复步骤:"
                echo "1. 根据上述根因分析修复问题"
                echo "2. 提交修复代码"
                echo "3. 重新发布新版本（使用新版本号）"
                echo "4. 重新运行此监控脚本"
                
                # 更新结果
                update_results $check_count "failed" "部署失败，已检查根因"
                break
                ;;
            2)  # 被取消
                echo ""
                echo "⚠️ 部署被取消"
                echo "请检查 GitHub Actions 是否被手动取消"
                update_results $check_count "cancelled" "部署被取消"
                break
                ;;
            3)  # 进行中
                echo ""
                echo "⏳ 部署进行中，等待 10 分钟后再次检查..."
                update_results $check_count "in_progress" "部署进行中"
                sleep 600  # 10 分钟
                ;;
        esac
    done
    
    # 最终结果
    echo ""
    echo "=========================================="
    echo "监控结束"
    echo "=========================================="
    
    if [ "$success" = true ]; then
        echo "✅ 部署成功！"
        echo "版本 $VERSION 已成功部署"
        
        # 更新结果文件
        if command -v jq &> /dev/null; then
            local temp_file=$(mktemp)
            jq '.status = "success" | .final_result = "success" | .end_time = "$(date -u +%Y-%m-%dT%H:%M:%SZ)"' \
               "$RESULTS_FILE" > "$temp_file" && mv "$temp_file" "$RESULTS_FILE"
        fi
        
        return 0
    elif [ "$failed" = true ]; then
        echo "❌ 部署失败"
        echo "版本 $VERSION 部署失败，请检查根因并修复"
        
        # 更新结果文件
        if command -v jq &> /dev/null; then
            local temp_file=$(mktemp)
            jq '.status = "failed" | .final_result = "failed" | .end_time = "$(date -u +%Y-%m-%dT%H:%M:%SZ)"' \
               "$RESULTS_FILE" > "$temp_file" && mv "$temp_file" "$RESULTS_FILE"
        fi
        
        return 1
    else
        echo "⏰ 监控超时"
        echo "已检查 $MAX_CHECKS 次，部署仍在进行中"
        echo "请手动检查 GitHub Actions 状态"
        
        # 更新结果文件
        if command -v jq &> /dev/null; then
            local temp_file=$(mktemp)
            jq '.status = "timeout" | .final_result = "timeout" | .end_time = "$(date -u +%Y-%m-%dT%H:%M:%SZ)"' \
               "$RESULTS_FILE" > "$temp_file" && mv "$temp_file" "$RESULTS_FILE"
        fi
        
        return 2
    fi
}

# 显示使用说明
show_help() {
    echo ""
    echo "📖 使用说明:"
    echo "----------------------------------------"
    echo "1. 在发布新版本后运行此脚本"
    echo "2. 脚本会每 10 分钟检查一次部署状态"
    echo "3. 如果部署失败，会自动检查根因"
    echo "4. 最多检查 $MAX_CHECKS 次（约 $((MAX_CHECKS * 10 / 60)) 小时）"
    echo "5. 结果保存在 $RESULTS_FILE"
    echo "6. 日志保存在 $LOG_FILE"
    echo ""
    echo "💡 提示:"
    echo "- 如果需要重新部署，请使用新版本号"
    echo "- 不要复用失败的版本号"
    echo "- 修复问题后重新运行版本发布脚本"
}

# 开始监控
show_help
main_monitor
