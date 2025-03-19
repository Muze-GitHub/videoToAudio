const express = require('express')
const tencentcloud = require('tencentcloud-sdk-nodejs')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 8081

// 腾讯云配置
const clientConfig = {
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY
  },
  region: 'ap-guangzhou',
  profile: {
    httpProfile: {
      endpoint: 'asr.tencentcloudapi.com'
    }
  }
}

// 创建 ASR 客户端
const AsrClient = tencentcloud.asr.v20190614.Client
const client = new AsrClient(clientConfig)

app.use(express.json())

// 创建语音识别任务
async function createRecTask(url) {
  const params = {
    EngineModelType: '16k_zh',
    ChannelNum: 1,
    ResTextFormat: 0,
    SourceType: 0,
    Url: url
  }

  try {
    console.log('创建识别任务，参数:', JSON.stringify(params))
    const result = await client.CreateRecTask(params)
    console.log('创建任务结果:', JSON.stringify(result))

    if (!result || !result.Data || !result.Data.TaskId) {
      throw new Error('创建任务响应格式错误: ' + JSON.stringify(result))
    }

    return result.Data.TaskId
  } catch (error) {
    console.error('创建任务失败:', error)
    throw error
  }
}

// 查询识别结果
async function getRecTaskResult(taskId) {
  try {
    const result = await client.DescribeTaskStatus({
      TaskId: taskId
    })
    console.log('查询结果:', JSON.stringify(result))

    if (!result) {
      throw new Error('查询任务响应格式错误: ' + JSON.stringify(result))
    }

    return result
  } catch (error) {
    console.error('查询任务失败:', error)
    throw error
  }
}

// 轮询任务结果
async function pollTaskResult(taskId, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const interval = setInterval(async () => {
      try {
        const result = await getRecTaskResult(taskId)
        console.log(`轮询结果 (第${attempts + 1}次):`, JSON.stringify(result))

        // 2:任务成功 3:任务失败
        if (result.Data.Status === 2) {
          clearInterval(interval)
          resolve(result.Data)
        } else if (result.Data.Status === 3) {
          clearInterval(interval)
          reject(
            new Error('识别任务失败: ' + (result.Data.ErrorMsg || '未知错误'))
          )
        } else {
          console.log(`任务进行中... (状态: ${result.Data.Status})`)
        }

        attempts++
        if (attempts >= maxAttempts) {
          clearInterval(interval)
          reject(new Error('任务超时'))
        }
      } catch (error) {
        clearInterval(interval)
        reject(error)
      }
    }, 3000)
  })
}

// 测试get
app.get('/', (req, res) => {
  res.json({
    message: 'Hello, World!'
  })
})

// API 端点
app.post('/recognize', async (req, res) => {
  try {
    console.log('收到请求:', req.body)
    const { videoUrl } = req.body

    if (!videoUrl) {
      return res.status(400).json({
        thoughts: '缺少必要的视频URL参数',
        tool_calls: []
      })
    }

    // 创建识别任务
    const taskId = await createRecTask(videoUrl)
    console.log('创建任务成功，TaskId:', taskId)

    // 轮询获取结果
    const result = await pollTaskResult(taskId)
    console.log('识别完成，结果:', JSON.stringify(result))

    res.json({
      thoughts: '视频音频转文字完成',
      tool_calls: [
        {
          type: 'text',
          text: {
            content: result.Result || '无识别结果',
            recognition_status: 'success',
            task_id: taskId
          }
        }
      ]
    })
  } catch (error) {
    console.error('处理失败:', error)
    res.status(500).json({
      thoughts: '处理过程中发生错误',
      error: error.message,
      tool_calls: []
    })
  }
})

// 启动服务器
app.listen(port, () => {
  console.log(`语音识别服务器运行在端口 ${port}`)
})

// curl -X POST -H "Content-Type: application/json" -d '{"videoUrl":"https://fearch.zhuanstatic.com/video_res_m82p1munala.mp4"}' https://4b1c-120-229-46-44.ngrok-free.app/recognize
