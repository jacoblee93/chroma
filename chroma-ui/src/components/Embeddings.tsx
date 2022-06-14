// @ts-nocheck

import React, { useEffect, useState } from 'react';
import { useTheme, Spinner, Center } from '@chakra-ui/react'
import PageContainer from './containers/PageContainer';
import Header from './Header';
import RightSidebar from './RightSidebar';
import LeftSidebar from './LeftSidebar';
import EmbeddingsContainer from './EmbeddingsViewer/EmbeddingsContainer';
import distinctColors from 'distinct-colors'
import chroma from "chroma-js" // nothing to do with us! a color library

function getEmbeddings(cb) {
  fetch(`/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query fetchAllEmbeddings {
        datapoints {
          datapoints {
            x,
            y,
            metadata
          }
        }
      }`,
    }),
  })
    .then(res => res.json())
    .then(res => {
      cb(res.data.datapoints.datapoints)
    })
    .catch(console.error)
}

// first we want to find the unique values in our metadata
// and create sets of them
var generateMetadataSets = function (testData) {
  var metadataSets = {}
  testData.forEach((data) => {
    // metadata stored in the third place in the array
    for (const [k, v] of Object.entries(JSON.parse(data.metadata))) {
      if (metadataSets[k] === undefined) {
        metadataSets[k] = new Set()
      }
      metadataSets[k].add(v)
    }
  })
  return metadataSets
}

// then we want to build a multi-layered object that we will
// use to render the left sidebar
// currently this is opinionated as classes -> types
var generateLeftSidebarObject = function (metadataSets) {
  var numberOfColors = metadataSets.class.size

  // https://medialab.github.io/iwanthue/
  let colorsOpts = distinctColors({
    "count": numberOfColors,
    "lightMin": 20,
    "lightMax": 80,
    "chromaMin": 80
  })

  var colors = []
  // right now the ordering of these is very sensitive to the
  // order of the colors passed to scatterplot in scatterplot.tsx
  var classTypeDict = []
  var classOptions = metadataSets.class
  var typeOptions = metadataSets.type
  var i = 0;
  classOptions.forEach(option => {
    classTypeDict.push({
      class: option,
      title: option,
      subtypes: [],
      visible: true,
      color: chroma(colorsOpts[i]).hex()
    })

    i++
  })
  classTypeDict.forEach(cClass => {
    typeOptions.forEach(option => {
      let color;
      if (option === 'production') {
        color = chroma(cClass.color).brighten().hex()
      } else if (option === 'test') {
        color = chroma(cClass.color).darken().hex()
      } else {
        color = cClass.color
      }
      colors.push(color)

      cClass.subtypes.push({
        type: option,
        title: option,
        visible: true,
        color: color
      })
    })
  })
  return [classTypeDict, colors]
}

// then we take the data format that were given by the server for points
// and get it into the format that we can pass to regl-scatterplot
var dataToPlotter = function (testData, classTypeDict) {

  var minX = Infinity
  var minY = Infinity
  var maxX = -Infinity
  var maxY = -Infinity

  var dataToPlot = []
  testData.forEach((data) => {
    // x is in pos 0, and y in pos 1
    // pos3 is opacity (0-1), pos4 is class (int)
    // color map for the classes are set in scatterplot
    var metadata = JSON.parse(data.metadata)
    var objectIndex = classTypeDict.findIndex((t, index) => t.title === metadata.class);
    var typeIndexOffset = classTypeDict[objectIndex].subtypes.findIndex((t, index) => t.title === metadata.type)
    var classVisible = classTypeDict[objectIndex].visible
    var typeVisble = classTypeDict[objectIndex].subtypes[typeIndexOffset].visible

    var opacity = 1
    if (!typeVisble) {
      opacity = 0
    } else if (!classVisible) {
      opacity = 0
    }

    if (data.y < minY) minY = data.y
    if (data.y > maxY) maxY = data.y
    if (data.x < minX) minX = data.x
    if (data.x > maxX) maxX = data.x

    dataToPlot.push([data.x, data.y, opacity, (objectIndex * 3) + typeIndexOffset])
  })

  var centerX = (maxX + minX) / 2
  var centerY = (maxY + minY) / 2

  var sizeX = (maxX - minX) / 2
  var sizeY = (maxY - minY) / 2

  return {
    dataToPlot: dataToPlot,
    dataBounds: {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      centerX: centerX,
      centerY: centerY,
      maxSize: (sizeX > sizeY) ? sizeX : sizeY
    }
  }
}

function Embeddings() {
  const theme = useTheme()

  let [serverData, setServerData] = useState<any>([]);
  let [points, setPoints] = useState<any>(null);
  let [toolSelected, setToolSelected] = useState<any>('cursor');
  let [cursor, setCursor] = useState('select-cursor');
  let [selectedPoints, setSelectedPoints] = useState([]) // callback from regl-scatterplot
  let [unselectedPoints, setUnselectedPoints] = useState([]) // passed down to regl-scatterplot
  let [classDict, setClassDict] = useState(undefined) // object that renders the left sidebar
  let [colorsUsed, setColorsUsed] = useState([])
  let [target, setTarget] = useState([])
  let [maxSize, setMaxSize] = useState(1)

  // set up data onload
  useEffect(() => {
    getEmbeddings(dataFromServer => {
      var metadataSets = generateMetadataSets(dataFromServer)
      var response = generateLeftSidebarObject(metadataSets)
      var classTypeDict = response[0]
      var colors = response[1]
      setColorsUsed(colors)

      var dataAndCamera = dataToPlotter(dataFromServer, classTypeDict)
      setClassDict(classTypeDict)

      setTarget([dataAndCamera.dataBounds.centerX, dataAndCamera.dataBounds.centerY])
      setMaxSize(dataAndCamera.dataBounds.maxSize)

      // needs to be run last
      setPoints(dataAndCamera.dataToPlot)
      setServerData(dataFromServer)
    })
  }, []);

  // Callback functions that are fired by regl-scatterplot
  const selectHandler = ({ points: newSelectedPoints }) => {
    setUnselectedPoints([])
    setSelectedPoints(newSelectedPoints)
  }
  const deselectHandler = () => {
    console.log('deselected points')
    setSelectedPoints([])
  };

  // Topbar functions passed down
  function moveClicked() {
    setToolSelected('cursor')
    setCursor('select-cursor')
  }
  function lassoClicked() {
    setToolSelected('lasso')
    setCursor('crosshair')
  }

  // Left sidebar functions passed down
  // - these trigger the classes to be hidden or shown
  function classClicked(returnObject: string): void {
    var objectIndex = classDict.findIndex((t, index) => t.title == returnObject.text)
    var currentVisibility = classDict[objectIndex].visible
    classDict[objectIndex].visible = !currentVisibility
    classDict[objectIndex].subtypes.forEach((subtype) => (subtype.visible = !currentVisibility))
    setClassDict([...classDict])
    updatePointVisiblity()
  }
  function typeClicked(returnObject: string): void {
    var objectIndex = classDict.findIndex((t, index) => t.title === returnObject.classTitle)
    var subTypeIndex = classDict[objectIndex].subtypes.findIndex((subtype) => subtype.title === returnObject.text)
    var currentVisibility = classDict[objectIndex].subtypes[subTypeIndex].visible
    classDict[objectIndex].subtypes[subTypeIndex].visible = !currentVisibility
    setClassDict([...classDict])
    updatePointVisiblity()
  }

  function updatePointVisiblity() {
    setPoints(dataToPlotter(serverData, classDict))
  }

  // Right sidebar functions passed down
  function clearSelected(pointsToUnselect) {
    if (pointsToUnselect !== undefined) {
      setUnselectedPoints(pointsToUnselect)
    } else {
      setUnselectedPoints(selectedPoints)
    }
  }
  function tagSelected() {
    console.log('tagSelected')
  }

  var gotPointData = (points === null)

  return (
    <div>
      <PageContainer>
        <Header toolSelected={toolSelected} moveClicked={moveClicked} lassoClicked={lassoClicked}></Header>
        <LeftSidebar showSkeleton={gotPointData} classDict={classDict} classClicked={classClicked} typeClicked={typeClicked}></LeftSidebar>
        <EmbeddingsContainer
          points={points}
          toolSelected={toolSelected}
          selectHandler={selectHandler}
          deselectHandler={deselectHandler}
          unselectedPoints={unselectedPoints}
          cursor={cursor}
          colors={colorsUsed}
          target={target}
          maxSize={maxSize}
          showLoading={gotPointData}
        ></EmbeddingsContainer>
        <RightSidebar
          selectedPoints={selectedPoints}
          clearSelected={clearSelected}
          tagSelected={tagSelected}
          serverData={serverData}
        ></RightSidebar>
      </PageContainer>
    </div>
  )
}

export default Embeddings
