# 🔍 GodEye

A comprehensive monitoring and analytics plugin for Claude Code that provides real-time insights into your AI sessions.

## Overview

GodEye is a Claude Code plugin that gives you visibility into your AI conversations with live metrics, cost tracking, session management, and agent monitoring. Think of it as your command center for understanding what's happening under the hood of your Claude sessions.

## Features

### 📊 Real-Time Vitals
- **Token Flow Tracking**: Monitor input, output, cache reads, and cache writes in real-time
- **Output Rate**: See tokens per second for active responses
- **Context Usage**: Track context window utilization with visual indicators
- **Sparkline Visualizations**: Historical token output patterns at a glance

### 💰 Cost Management
- **Live Cost Tracking**: Real-time USD cost calculation for current session
- **Daily Spend Limits**: Set and monitor daily spending limits
- **Usage Breakdown**: Detailed cost analysis by time buckets
- **Multi-Session Aggregation**: Track costs across all active sessions

### 🤖 Agent Monitoring
- **Agent Lifecycle Tracking**: Monitor spawned agents and their status
- **Progress Indicators**: Visual progress bars for agent tasks
- **Resource Attribution**: See token and cost breakdown per agent
- **Session Comparison**: Compare activity across multiple sessions

### 🎯 Session Intelligence
- **Status Tracking**: Real-time session state (idle, working, input, done, failed)
- **Project Context**: Associate sessions with specific projects
- **Session History**: Browse and compare past and current sessions
- **Activity Timeline**: Track elapsed time and activity patterns

### 📝 Planning & Progress
- **Plan Management**: Create and track implementation plans
- **Todo Integration**: Built-in task tracking with status indicators
- **Progress Visualization**: Visual progress bars and completion metrics
- **AI Addition Tracking**: Monitor AI contributions to plans

### 🎨 Visual Customization
- **Animated Indicators**: Choose from multiple animation styles (eyeclock, pulse, etc.)
- **Custom Themes**: Claude orange on dark by default
- **Configurable Displays**: Show/hide sections based on your needs
- **Live Updates**: Smooth animations and real-time data refresh

## Installation

### From Source

1. Clone or download this repository to your Claude mods directory:
```bash
cd ~/.claude/mods
git clone <repository-url> godeye
```

2. The plugin will be automatically detected by Claude Code on next launch.

### Location
The plugin should be installed at:
```
~/.claude/mods/godeye/
```

## Usage

### Accessing GodEye

Once installed, GodEye runs automatically in the background, monitoring your Claude sessions. Access the interface through:

- **Pane View**: Opens a dedicated pane with tabs for different views
- **Status Line**: Shows live vitals in your status bar (if configured)

### Tabs

1. **GodEye** - Main monitoring dashboard with vitals and cost
2. **Plans** - Manage implementation plans and todos
3. **Settings** - Configure limits and preferences

### Key Metrics Explained

- **Tokens**: Total context tokens used in the current turn
- **Cache Hit Rate**: Percentage of tokens served from cache (saves cost)
- **Output Rate**: Tokens per second for streaming responses
- **Cost**: Real-time USD cost for the session
- **Status**: Current session state (working, idle, etc.)

## Architecture

### Core Modules

- **`vitals.ts`** - Real-time metrics calculation and flow tracking
- **`pricing.ts`** - Cost calculation using official Claude API pricing
- **`sessions.ts`** - Multi-session tracking and state management
- **`progress.ts`** - Task and plan progress tracking
- **`usage.ts`** - Daily usage aggregation and limit enforcement
- **`animations.ts`** - Visual effects and indicator animations
- **`register.tsx`** - Main plugin registration and UI rendering

### Data Flow

1. **Event Hooks**: Listens to Claude Code events (tool calls, responses, etc.)
2. **State Management**: Uses Claude Code's atom-based state system
3. **Shared Storage**: Cross-session data stored in `~/.claude/godeye-shared/`
4. **Real-Time Updates**: Timer-based refresh for live metrics

### Storage

- **Session State**: Ephemeral data in Claude Code's state atoms
- **Shared Data**: Persistent cross-session data in filesystem
- **Location**: `~/.claude/godeye-shared/` for session records

## Development

### Requirements

- Claude Code 2.1.299 or newer
- TypeScript 5.4+

### Project Structure

```
godeye/
├── hooks/
│   ├── register.tsx      # Main plugin entry point
│   ├── vitals.ts         # Token and flow metrics
│   ├── pricing.ts        # Cost calculations
│   ├── sessions.ts       # Session management
│   ├── progress.ts       # Plan and todo tracking
│   ├── usage.ts          # Daily usage tracking
│   ├── animations.ts     # Visual effects
│   └── hooks.json        # Hook configuration
├── types/
│   └── index.d.ts        # TypeScript definitions
├── .claude-plugin/       # Generated type definitions
└── tsconfig.json         # TypeScript configuration
```

### Testing

Run the test suite:
```bash
claude plugin test ~/.claude/mods/godeye
```

### Validation

Validate the plugin structure:
```bash
claude plugin validate ~/.claude/mods/godeye
```

## Configuration

### Daily Spend Limit

Set your daily spending limit (default: $5.00):
```typescript
// Configurable via the Settings tab in GodEye UI
const DEFAULT_DAY_LIMIT = 5.00
```

### Animation Style

Choose from available animations:
- `eyeclock` - Rotating eye animation
- `pulse` - Pulsing indicator
- Custom animations defined in `animations.ts`

### Cache TTL

Configure cache behavior for long TTL optimization:
```typescript
// Automatically detected based on pricing model
// Affects cold start penalty calculations
```

## Pricing Models

GodEye uses official Claude API pricing:

- **Sonnet 4.5**: $3.00 / $15.00 per MTok (input/output)
- **Opus 5.5**: $15.00 / $75.00 per MTok
- **Haiku 5.5**: $0.40 / $2.00 per MTok
- **Fable 5.1**: $0.10 / $0.50 per MTok

Cache pricing:
- **Write**: 25% of base input price
- **Read**: 10% of base input price

## Troubleshooting

### Plugin Not Loading

1. Verify installation path: `~/.claude/mods/godeye/`
2. Check hooks.json exists and is valid
3. Run validation: `claude plugin validate ~/.claude/mods/godeye`

### Shared Data Not Syncing

- Ensure `~/.claude/godeye-shared/` directory is writable
- Check for file permission issues
- Verify $HOME environment variable is set

### Metrics Not Updating

- Check that the session is active (not idle)
- Verify event hooks are registered
- Look for errors in Claude Code debug logs

## Contributing

This is an open plugin for Claude Code. Contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

[Add your license here]

## Acknowledgments

Built with the Claude Code Plugin API. Names considered during development: god-eye (chosen), panopticon, argus, overwatch, sentinel, oculus.

---

**Note**: This is an early access plugin. The API surface may change between Claude Code releases.
