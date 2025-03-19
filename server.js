const express = require('express')
const ffmpeg = require('fluent-ffmpeg')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const app = express()
const port = process.env.PORT || 8080

// 添加 CORS 支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// 创建 audio 目录（如果不存在）
const audioDir = path.join(__dirname, 'audio')
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir)
}

app.use(express.json())

// 下载视频
function downloadVideo(url, outputPath) {
  return new Promise((resolve, reject) => {
    const encodedUrl = encodeURI(url)
    console.log('正在下载视频:', encodedUrl)

    const file = fs.createWriteStream(outputPath)
    https
      .get(encodedUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`视频下载失败，状态码: ${response.statusCode}`))
          return
        }

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          console.log('视频下载完成:', outputPath)
          resolve()
        })
      })
      .on('error', (err) => {
        fs.unlink(outputPath, () => {})
        reject(err)
      })
  })
}

// 提取 MP3
function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log('正在提取音频...')
    ffmpeg(inputPath)
      .output(outputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .on('end', () => {
        console.log('音频提取完成:', outputPath)
        fs.unlink(inputPath, (err) => {
          if (!err) console.log('已删除临时视频文件:', inputPath)
        })
        resolve()
      })
      .on('error', (err) => {
        reject(err)
      })
      .run()
  })
}

// API 端点
app.post('/convert', async (req, res) => {
  console.log('===我被请求 post,', req.body)
  try {
    const { videoUrl } = req.body

    if (!videoUrl) {
      return res.status(400).json({
        error: '请提供视频URL',
        thoughts: '缺少必要的视频URL参数',
        tool_calls: []
      })
    }

    const fileName = uuidv4()
    const videoPath = path.join(__dirname, `${fileName}.mp4`)
    const audioPath = path.join(audioDir, `${fileName}.mp3`)

    // 下载并转换
    await downloadVideo(videoUrl, videoPath)
    await extractAudio(videoPath, audioPath)

    // 获取文件大小
    const stats = fs.statSync(audioPath)
    const fileSizeInBytes = stats.size
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2)

    // 构建完整的音频文件URL，使用请求的 host
    const protocol = req.headers['x-forwarded-proto'] || req.protocol
    const host = req.headers['x-forwarded-host'] || req.get('host')
    const audioUrl = `${protocol}://${host}/audio/${fileName}.mp3`

    res.json({
      thoughts: '视频已成功转换为音频文件',
      tool_calls: [
        {
          type: 'audio',
          audio: {
            url: audioUrl,
            size_mb: fileSizeInMB,
            format: 'mp3',
            name: `${fileName}.mp3`
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

// 测试
app.get('/', (req, res) => {
  res.send('Hello World')
  console.log('----xzl')
})

// 提供音频文件下载
app.use('/audio', express.static(audioDir))

// 启动服务器
const server = app.listen(port, () => {
  const interfaces = require('os').networkInterfaces()
  console.log('网络接口信息:')
  Object.keys(interfaces).forEach((iface) => {
    interfaces[iface].forEach((details) => {
      if (details.family === 'IPv4') {
        console.log(`  http://${details.address}:${port}`)
      }
    })
  })
  console.log(`服务器运行在端口 ${port}`)
})

// curl -X POST \
// -H "Content-Type: application/json" \
// -d '{"videoUrl":"https://fearch.zhuanstatic.com/video_res_m82p1munala.mp4"}' \
// https://e178-240e-3b7-401-5550-7cc8-ca88-f590-45a7.ngrok-free.app/convert
