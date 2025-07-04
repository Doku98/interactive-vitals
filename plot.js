const margin = { top: 50, right: 40, bottom: 50, left: 60 };
const width = 1100 - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;

const svg = d3.select("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
  .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

const tooltip = d3.select("#tooltip");
const drugSelect = d3.select("#drugSelect");

const x = d3.scaleLinear().domain([0, 1]).range([0, width]);
const y = d3.scaleLinear().range([height, 0]);

svg.append("g").attr("transform", `translate(0,${height})`).attr("class", "x-axis");
svg.append("g").attr("class", "y-axis");

svg.append("text")
  .attr("text-anchor", "middle")
  .attr("x", width / 2)
  .attr("y", height + margin.bottom - 5)
  .attr("class", "axis-label")
  .text("Progress Through Surgery");

svg.append("text")
  .attr("text-anchor", "middle")
  .attr("transform", `rotate(-90)`)
  .attr("x", -height / 2)
  .attr("y", -margin.left + 15)
  .attr("class", "axis-label")
  .text("Average Vital Value");

const xAxis = d3.axisBottom(x).tickFormat(d3.format(".0%"));
const yAxis = d3.axisLeft(y);

const line = d3.line()
  .x(d => x(d.norm_time))
  .y(d => y(d.mean))
  .curve(d3.curveMonotoneX);

const area = d3.area()
  .x(d => x(d.norm_time))
  .y0(d => y(d.mean - (d.sd || 0)))
  .y1(d => y(d.mean + (d.sd || 0)))
  .curve(d3.curveMonotoneX);

const color = d3.scaleOrdinal(d3.schemeCategory10);

const vitalSelect = d3.select("#vitalSelect");
const groupSelect = d3.select("#groupSelect");

let activeGroups = new Set();

//loading all data
Promise.all([
    d3.csv("data/long_surgery_vitals.csv", d3.autoType),
    d3.csv("data/anesthetic_start_times.csv", d3.autoType)
    ]).then(([data, anesthetics]) => {
    data.forEach(d => d.signal = d.signal.toLowerCase());

    const allDrugs = [...new Set(anesthetics
        .map(d => d.tname)
        .filter(name => name.toLowerCase().includes("rate"))
      )];      
    const drugNameMap = {
        "orchestra/rftn20_rate": "Remifentanil",
        "orchestra/ppf20_rate": "Propofol"
      };
      

    drugSelect.selectAll("option")
      .data(["All", ...allDrugs])
      .enter().append("option")
      .text(d => d === "All" ? "All" : drugNameMap[d.toLowerCase()] || d)
      .attr("value", d => d);
    

    anesthetics.forEach(d => {
        d.tname = d.tname.toLowerCase();
        d.optype = d.optype.trim();
    });


  const vitals = [...new Set(data.map(d => d.signal))];
  const groups = ["optype", "emop"];

  vitalSelect.selectAll("option")
    .data(vitals).enter().append("option")
    .text(d => d).attr("value", d => d);

  groupSelect.selectAll("option")
    .data(groups).enter().append("option")
    .text(d => d === "optype" ? "Surgery Type" : "Emergency Status")
    .attr("value", d => d);

  function updateChart() {
    const selectedVital = vitalSelect.property("value");
    const selectedGroup = groupSelect.property("value");
    const selectedDrug = drugSelect.property("value").toLowerCase();

    const filtered = data.filter(d => d.signal === selectedVital);
    const nested = d3.groups(filtered, d => d[selectedGroup]);

    const summary = nested.map(([key, values]) => {
      const binSize = 0.01;
      const binned = d3.groups(values, d => Math.round(d.norm_time / binSize) * binSize)
        .map(([t, pts]) => {
          const v = pts.map(p => p.value);
          return {
            norm_time: +t,
            mean: d3.mean(v),
            sd: d3.deviation(v)
          };
        });
      return { key, values: binned.sort((a, b) => a.norm_time - b.norm_time) };
    });
    //visable being the types of surgey we want to dispaly 
    const visible = summary.filter(d => activeGroups.size === 0 || activeGroups.has(d.key));

    y.domain([
      d3.min(visible, s => d3.min(s.values, d => d.mean - (d.sd || 0))),
      d3.max(visible, s => d3.max(s.values, d => d.mean + (d.sd || 0)))
    ]);

    svg.select(".x-axis").call(xAxis);
    svg.select(".y-axis").call(yAxis);

    svg.selectAll(".line").data(visible, d => d.key)
      .join("path")
      .attr("class", "line")
      .attr("fill", "none")
      .attr("stroke", d => color(d.key))
      .attr("stroke-width", 2)
      .attr("d", d => line(d.values));

    svg.selectAll(".area").data(visible, d => d.key)
      .join("path")
      .attr("class", "area")
      .attr("fill", d => color(d.key))
      .attr("fill-opacity", 0.2)
      .attr("stroke", "none")
      .attr("d", d => area(d.values));

    // Added anesthesia start markers
    svg.selectAll(".drug-marker").remove();

    visible.forEach(group => {
      const groupKey = group.key;

      const matchingDrugs = d3.groups(
        anesthetics.filter(d =>
          d[selectedGroup] === groupKey &&
          (selectedDrug.toLowerCase() === "all" || d.tname === selectedDrug) &&
          !isNaN(d.surgery_duration) &&
          d.surgery_duration > 0
        ),
        d => d.tname
       ).map(([drugName, entries]) => {
        const avgStartNorm = d3.mean(entries, d => d.norm_start_time);
        const avgDuration = d3.mean(entries, d => d.surgery_duration);
        const start_time_sec = avgStartNorm * avgDuration;
      
        return {
          tname: drugName,
          norm_start_time: avgStartNorm,
          start_time_sec: start_time_sec
        };
      });
      
      

      matchingDrugs.forEach(d => {
        const drugColor = color(groupKey);

        svg.append("line")
          .attr("class", "drug-marker")
          .attr("x1", x(d.norm_start_time))
          .attr("x2", x(d.norm_start_time))
          .attr("y1", 0)
          .attr("y2", height)
          .attr("stroke", drugColor)
          .attr("stroke-dasharray", "2,2")
          .attr("stroke-width", 1.2);

          svg.append("circle")
          .attr("class", "drug-marker")
          .attr("cx", x(d.norm_start_time))
          .attr("cy", 0)
          .attr("r", 4)
          .attr("fill", color(groupKey))
          .on("mouseover", function(event) {
            d3.select(this)
              .transition().duration(100)
              .attr("r", 6);
        
            tooltip
              .style("opacity", 1)
              .html(`
                <strong>${drugNameMap[d.tname] || d.tname}</strong><br>
                Surgery: ${groupKey}<br>
                Start of Drug: ${(d.norm_start_time * 100).toFixed(1)}% into surgery<br>
                Elapsed Time: ${Math.floor(d.start_time_sec / 60)} min ${Math.round(d.start_time_sec % 60)} sec
              `)
              .style("left", (event.pageX + 8) + "px")
              .style("top", (event.pageY - 28) + "px");
          })
          .on("mouseout", function() {
            d3.select(this).transition().duration(100).attr("r", 4);
            tooltip.style("opacity", 0);
          });        
      });
    });

// Added interation with the legend so user can click on type of surgery on the legend
    const legendContainer = d3.select("#legend");
    legendContainer.html("");
    const legendItems = legendContainer.selectAll("div")
      .data(summary.map(d => d.key))
      .enter()
      .append("div")
      .attr("class", "legend-item")
      .style("cursor", "pointer")
      //lets user know what is selected by increaseing opacity of selected surguries 
      .style("opacity", d => activeGroups.size === 0 || activeGroups.has(d) ? 1 : 0.3)
      .on("click", (event, key) => {
        if (activeGroups.has(key)) {
          activeGroups.delete(key);
        } else {
          activeGroups.add(key);
        }
        updateChart();
      })
      .on("mouseover", (event, key) => {
        svg.selectAll(".line").style("opacity", d => d.key === key ? 1 : 0.1);
        svg.selectAll(".area").style("opacity", d => d.key === key ? 0.3 : 0.05);
      })
      .on("mouseout", () => {
        svg.selectAll(".line").style("opacity", 1);
        svg.selectAll(".area").style("opacity", 0.2);
      });

    legendItems.append("span")
      .attr("class", "legend-color")
      .style("background-color", d => color(d));

    legendItems.append("span")
      .attr("class", "legend-label")
      .text(d => d.length > 20 ? d.slice(0, 18) + "…" : d);
  }

  vitalSelect.on("change", updateChart);
  groupSelect.on("change", updateChart);
  drugSelect.on("change", updateChart);
  vitalSelect.property("value", "map");
  groupSelect.property("value", "emop");
  drugSelect.property("value", "All");
  updateChart();
});