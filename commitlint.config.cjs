// For More detail please refer: https://commitlint.js.org/#/reference-plugins?id=local-plugins
module.exports = {
  // 继承的规则
  extends: ['@commitlint/config-conventional'],
  // 定义规则类型
  rules: {
    // type 类型定义，表示 git 提交的 type 必须在以下类型范围内
    'type-enum': [
      2,
      'always',
      [
        'Feat', // 新功能
        'Add', // 新增
        'Delete', // 删除文件
        'Remove', // 移除代码
        'Modify', // (调整/修改)
        'Fix', // 修复 bug
        'Upgrade', // 升级
        'Refactor', // 重构(既不增加新功能，也不是修复bug)
        'Test', // 增加测试
        'Chore', // 构建过程或辅助工具的变动
        'Merge', // 合并分支
        'Revert', // 回退
        'Optimize', // 优化相关，比如提升性能、体验等
        'CI', // 与持续集成服务有关的改动
        'Release', // 发布新版本
        'WIP', // 开发中,
        'Style' // 样式相关
      ]
    ],
    // type 大小写不做校验
    'type-case': [0],
    // subject 大小写不做校验
    'subject-case': [0]
  }
}
