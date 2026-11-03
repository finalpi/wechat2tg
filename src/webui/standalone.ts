import {config} from '../config'
import {startWebUI} from './server'

// Configure connections without starting Telegram or WeChat clients.
startWebUI(config)
