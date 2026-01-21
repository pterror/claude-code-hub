/**
 * Agent capability system
 *
 * Controls what agents can see and do with other agents.
 */

export interface AgentCapabilities {
  canDiscover: boolean;      // Can see other agents exist
  canRead: string[];         // Agent IDs it can read ("*" = all)
  canMessage: string[];      // Agent IDs it can message
  canSpawn: boolean;         // Can create new agents
  canBeMessaged: string[];   // Who can message this agent ("*" = all)
}

export type CapabilityPreset = "isolated" | "observer" | "peer" | "coordinator";

export const CAPABILITY_PRESETS: Record<CapabilityPreset, AgentCapabilities> = {
  isolated: {
    canDiscover: false,
    canRead: [],
    canMessage: [],
    canSpawn: false,
    canBeMessaged: [],
  },
  observer: {
    canDiscover: true,
    canRead: ["*"],
    canMessage: [],
    canSpawn: false,
    canBeMessaged: [],
  },
  peer: {
    canDiscover: true,
    canRead: ["*"],
    canMessage: ["*"],
    canSpawn: false,
    canBeMessaged: ["*"],
  },
  coordinator: {
    canDiscover: true,
    canRead: ["*"],
    canMessage: ["*"],
    canSpawn: true,
    canBeMessaged: ["*"],
  },
};

export function getDefaultCapabilities(): AgentCapabilities {
  return { ...CAPABILITY_PRESETS.isolated };
}

export function applyPreset(preset: CapabilityPreset): AgentCapabilities {
  return { ...CAPABILITY_PRESETS[preset] };
}

/**
 * Check if agent A can read agent B
 */
export function canRead(capabilities: AgentCapabilities, targetId: string): boolean {
  if (!capabilities.canDiscover) return false;
  return capabilities.canRead.includes("*") || capabilities.canRead.includes(targetId);
}

/**
 * Check if agent A can message agent B
 */
export function canMessage(
  senderCaps: AgentCapabilities,
  senderId: string,
  targetCaps: AgentCapabilities,
  targetId: string
): boolean {
  const senderCanSend = senderCaps.canMessage.includes("*") || senderCaps.canMessage.includes(targetId);
  const targetAccepts = targetCaps.canBeMessaged.includes("*") || targetCaps.canBeMessaged.includes(senderId);
  return senderCanSend && targetAccepts;
}
