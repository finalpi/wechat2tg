import * as mqtt from 'mqtt'
import {config} from '../config'
import {LogUtils} from '../util/LogUtil'

/**
 * MQTT 通知级别
 */
type NotifyLevel = 'info' | 'warn' | 'error'

/**
 * MQTT 通知消息体
 */
interface MqttNotifyPayload {
    action: 'notify'
    title: string
    content: string
    level: NotifyLevel
    timestamp: number
}

/**
 * MQTT 通知服务（单例）
 * 负责连接 MQTT Broker 并发送通知消息
 */
export class MqttNotifyService {
    private static instance: MqttNotifyService
    private client: mqtt.MqttClient | null = null
    private connected = false
    private logger = LogUtils.config().getLogger('MqttNotify')

    private constructor() {
        if (config.MQTT_ENABLED) {
            this.connect()
        }
    }

    static getInstance(): MqttNotifyService {
        if (!MqttNotifyService.instance) {
            MqttNotifyService.instance = new MqttNotifyService()
        }
        return MqttNotifyService.instance
    }

    /**
     * 连接 MQTT Broker
     */
    private connect(): void {
        if (!config.MQTT_BROKER_URL) {
            this.logger.error('MQTT_BROKER_URL 未配置，无法连接')
            return
        }

        const options: mqtt.IClientOptions = {
            clientId: config.MQTT_CLIENT_ID,
            clean: true,
            reconnectPeriod: 5000,
        }

        if (config.MQTT_USERNAME) {
            options.username = config.MQTT_USERNAME
        }
        if (config.MQTT_PASSWORD) {
            options.password = config.MQTT_PASSWORD
        }

        this.client = mqtt.connect(config.MQTT_BROKER_URL, options)

        this.client.on('connect', () => {
            this.connected = true
            this.logger.info(`已连接到 MQTT Broker: ${config.MQTT_BROKER_URL}`)
        })

        this.client.on('error', (err) => {
            this.logger.error('MQTT 连接错误:', err)
        })

        this.client.on('close', () => {
            this.connected = false
            this.logger.warn('MQTT 连接已断开')
        })

        this.client.on('reconnect', () => {
            this.logger.info('MQTT 正在重连...')
        })
    }

    /**
     * 发送通知到 MQTT
     * @param title 通知标题
     * @param content 通知内容
     * @param level 通知级别
     */
    notify(title: string, content: string, level: NotifyLevel = 'error'): void {
        if (!config.MQTT_ENABLED || !this.client) {
            return
        }

        const payload: MqttNotifyPayload = {
            action: 'notify',
            title,
            content,
            level,
            timestamp: Date.now(),
        }

        const message = JSON.stringify(payload)

        if (this.connected) {
            this.client.publish(config.MQTT_TOPIC, message, {qos: 1}, (err) => {
                if (err) {
                    this.logger.error('MQTT 消息发布失败:', err)
                }
            })
        } else {
            this.logger.warn('MQTT 未连接，通知消息丢弃')
        }
    }

    /**
     * 销毁服务，断开连接
     */
    destroy(): void {
        if (this.client) {
            this.client.end(true)
            this.client = null
            this.connected = false
        }
        MqttNotifyService.instance = undefined
        this.logger.info('MqttNotifyService 已销毁')
    }
}
